import { connect } from 'node:net';
import type { CommandAudit } from './command.js';
import type { Policy } from './types.js';
import type { Exception } from './util/exceptions.js';
import { socketPath, DAEMON_VERSION } from './daemon.js';

/**
 * Ask a running daemon to audit a command. Returns the audit, or null if no
 * daemon is reachable or anything goes wrong — callers must fall back to an
 * in-process audit. Never throws; bounded by `timeoutMs`.
 */
export function daemonAudit(
  command: string,
  policy: Policy,
  exceptions: Exception[],
  timeoutMs = 4000
): Promise<CommandAudit | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (v: CommandAudit | null) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* */ }
      resolve(v);
    };

    const sock = connect(socketPath());
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();

    let buf = '';
    sock.on('connect', () => {
      sock.write(JSON.stringify({ op: 'audit', v: DAEMON_VERSION, command, policy, exceptions }) + '\n');
    });
    sock.on('data', chunk => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      try {
        const res = JSON.parse(buf.slice(0, nl));
        finish(res && res.ok && res.audit ? (res.audit as CommandAudit) : null);
      } catch {
        finish(null);
      }
    });
    sock.on('error', () => { clearTimeout(timer); finish(null); });
  });
}
