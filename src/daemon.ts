/**
 * Optional resident daemon. The install guardrail spawns a fresh process per
 * gated install, so even with the disk cache each call pays process startup,
 * disk I/O, and a cold network connection. A long-lived daemon holds the caches
 * warm, reuses connections, and — crucially — memoizes recent verdicts, so a
 * repeated or retried install is answered in milliseconds.
 *
 * Everything degrades gracefully: if no daemon is running, callers fall back to
 * an in-process audit. Policy and exceptions are sent by the client with each
 * request, so the daemon never applies the wrong project's policy.
 */
import { createServer, type Server, connect } from 'node:net';
import { mkdirSync, chmodSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandAudit } from './command.js';
import type { Policy } from './types.js';
import type { Exception } from './util/exceptions.js';
import { cacheRoot } from './util/disk-cache.js';

function pkgVersion(): string {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0';
  }
}

// Identifies the daemon's code/protocol. A client whose version differs ignores
// the daemon and audits in-process, so a stale daemon left running after an
// upgrade can never serve a verdict from outdated audit logic. Bump the `/pN`
// suffix when the protocol or audit semantics change within the same release.
export const DAEMON_VERSION = `${pkgVersion()}/p1`;

export interface AuditRequest {
  op: 'audit' | 'ping' | 'shutdown';
  v?: string;
  command?: string;
  policy?: Policy;
  exceptions?: Exception[];
}

export type AuditHandler = (req: { command: string; policy: Policy; exceptions: Exception[] }) => Promise<CommandAudit>;

const MEMO_TTL_MS = 60_000;       // recent identical requests answered from memory
const IDLE_SHUTDOWN_MS = 15 * 60_000;

export function socketPath(): string {
  return process.env.HAWKEYE_DAEMON_SOCK || join(cacheRoot(), 'daemon.sock');
}

/**
 * Build the daemon server around an injectable audit handler (so it is testable
 * without the network). `idleMs` (when set) closes the server after inactivity.
 */
export function createDaemonServer(
  handler: AuditHandler,
  opts: { memoTtlMs?: number; idleMs?: number; onIdle?: () => void } = {}
): Server {
  const memoTtl = opts.memoTtlMs ?? MEMO_TTL_MS;
  const memo = new Map<string, { audit: CommandAudit; expiresAt: number }>();

  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdle = () => {
    if (!opts.idleMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (opts.onIdle ? opts.onIdle() : server.close()), opts.idleMs);
    idleTimer.unref?.();
  };

  const server = createServer(socket => {
    resetIdle();
    let buf = '';
    socket.on('data', async chunk => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        await handleLine(line, socket);
      }
    });
    socket.on('error', () => { /* client vanished — ignore */ });
  });

  async function handleLine(line: string, socket: import('node:net').Socket): Promise<void> {
    let req: AuditRequest;
    try { req = JSON.parse(line); } catch { socket.write('{"ok":false,"error":"bad request"}\n'); return; }
    resetIdle();

    if (req.op === 'ping') { socket.write(JSON.stringify({ ok: true, version: DAEMON_VERSION }) + '\n'); return; }
    if (req.op === 'shutdown') {
      socket.write('{"ok":true}\n');
      server.close();
      if (opts.onIdle) opts.onIdle();
      return;
    }
    if (req.op !== 'audit' || typeof req.command !== 'string' || !req.policy) {
      socket.write('{"ok":false,"error":"unsupported"}\n');
      return;
    }
    // Refuse requests from a different version — the client will fall back to an
    // in-process audit rather than trust a stale daemon's logic.
    if (req.v !== DAEMON_VERSION) {
      socket.write(JSON.stringify({ ok: false, error: 'version-mismatch', version: DAEMON_VERSION }) + '\n');
      return;
    }

    const key = JSON.stringify({ c: req.command, p: req.policy, e: req.exceptions ?? [] });
    const hit = memo.get(key);
    let audit: CommandAudit;
    if (hit && hit.expiresAt > Date.now()) {
      audit = hit.audit;
    } else {
      try {
        audit = await handler({ command: req.command, policy: req.policy, exceptions: req.exceptions ?? [] });
      } catch (err) {
        socket.write(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }) + '\n');
        return;
      }
      memo.set(key, { audit, expiresAt: Date.now() + memoTtl });
    }
    socket.write(JSON.stringify({ ok: true, audit }) + '\n');
  }

  return server;
}

/** Start the real daemon: warm caches + verdict memo, listening on the socket. */
export async function startDaemon(): Promise<void> {
  const { auditCommand } = await import('./command.js');
  const path = socketPath();
  try { mkdirSync(cacheRoot(), { recursive: true, mode: 0o700 }); } catch { /* ignore */ }

  // If a live daemon already owns the socket: defer when it's our version, but
  // take over a different (e.g. pre-upgrade) version by asking it to shut down.
  const running = await ping(path);
  if (running) {
    if (running === DAEMON_VERSION) {
      console.error('Hawkeye daemon already running.');
      return;
    }
    console.error(`Replacing daemon ${running} with ${DAEMON_VERSION}…`);
    await requestShutdown(path);
  }
  try { unlinkSync(path); } catch { /* no stale socket */ }

  const server = createDaemonServer(
    ({ command, policy, exceptions }) => auditCommand(command, policy, exceptions),
    { idleMs: IDLE_SHUTDOWN_MS, onIdle: () => { server.close(); try { unlinkSync(path); } catch { /* */ } process.exit(0); } }
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      try { chmodSync(path, 0o600); } catch { /* best-effort */ }
      console.error(`🎾 Hawkeye daemon listening at ${path}`);
      resolve();
    });
  });

  const shutdown = () => { try { server.close(); } catch { /* */ } try { unlinkSync(path); } catch { /* */ } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** The version of a live daemon on `path`, or null if none answers. */
function ping(path: string, timeoutMs = 500): Promise<string | null> {
  return new Promise(resolve => {
    const sock = connect(path);
    let buf = '';
    const done = (v: string | null) => { try { sock.destroy(); } catch { /* */ } resolve(v); };
    const timer = setTimeout(() => done(null), timeoutMs);
    timer.unref?.();
    sock.on('connect', () => sock.write('{"op":"ping"}\n'));
    sock.on('data', chunk => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      try { const r = JSON.parse(buf.slice(0, nl)); done(r?.ok ? (r.version ?? 'unknown') : null); }
      catch { done(null); }
    });
    sock.on('error', () => { clearTimeout(timer); done(null); });
  });
}

/** Ask a running daemon to shut down, then wait briefly for it to release the socket. */
function requestShutdown(path: string, timeoutMs = 1500): Promise<void> {
  return new Promise(resolve => {
    const sock = connect(path);
    const done = () => { try { sock.destroy(); } catch { /* */ } resolve(); };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    sock.on('connect', () => sock.write('{"op":"shutdown"}\n'));
    sock.on('data', () => { clearTimeout(timer); done(); });
    sock.on('error', () => { clearTimeout(timer); done(); });
  });
}
