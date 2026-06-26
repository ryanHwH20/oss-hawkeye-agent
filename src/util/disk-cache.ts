/**
 * Cross-process on-disk cache for deps.dev responses.
 *
 * The CLI's in-memory LRU only helps within a single process — but the install
 * guardrail spawns a *fresh* `hawkeye` process for every gated install, so that
 * cache is always cold and every install pays full network latency. This adds a
 * persistent layer so a second audit (a different process) reuses the first
 * one's metadata.
 *
 * What it caches — deliberately narrow for fail-closed safety:
 *   - `/versions/<v>` and `/versions/<v>:dependencies` — version-pinned deps.dev
 *     data is immutable, so it is safe to cache for a long time.
 *   - `/projects/<id>` — OpenSSF Scorecard. Advisory only (never flips a
 *     blocking verdict), so bounded staleness here is harmless.
 *
 * What it must NOT cache:
 *   - OSV vulnerability queries — handled elsewhere and intentionally always
 *     live, so a newly-disclosed CVE is never masked by a stale entry.
 *   - The mutable package-versions list (the "latest" resolver) and any
 *     `unavailable` result — only successful, immutable payloads are persisted.
 *
 * Integrity: a security tool must not trust its own cache blindly. Because
 * cached metadata (licenses, the dependency graph) feeds the verdict, a forged
 * entry could downgrade a BLOCKED package to SAFE. So:
 *   - the cache lives in a private, 0700 directory (not shared /tmp), files 0600;
 *   - every entry is authenticated with an HMAC keyed by a per-cache 0600 secret
 *     and bound to its URL — a tampered or forged entry fails verification and is
 *     treated as a miss.
 * This defeats cross-user and blind forgery. A same-user attacker who can run
 * arbitrary code (and thus read the key) is out of scope: at that point they can
 * already disable the guardrail outright.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const SCHEMA = 2; // bump to invalidate older on-disk formats

// 24h: version-pinned deps.dev payloads are immutable, so a long TTL is safe
// and maximizes hits. Read at call time so it stays overridable for tests.
function ttlMs(): number {
  return Number(process.env.HAWKEYE_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);
}

interface DiskEntry {
  v: number;
  url: string;
  expiresAt: number;
  value: unknown;
  mac: string;
}

/** Disk caching is on by default; set HAWKEYE_NO_CACHE to disable (e.g. tests). */
export function diskCacheEnabled(): boolean {
  return !process.env.HAWKEYE_NO_CACHE;
}

function defaultDir(): string {
  // Prefer a private per-user cache dir over shared /tmp, which on multi-user
  // systems is writable by others (cross-user cache-poisoning vector).
  try {
    const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
    return join(base, 'hawkeye');
  } catch {
    return join(tmpdir(), 'hawkeye-cache');
  }
}

function cacheDir(): string {
  return process.env.HAWKEYE_CACHE_DIR || defaultDir();
}

/** Only immutable version-pinned data and advisory scorecards are cacheable. */
export function isCacheable(url: string): boolean {
  return url.includes('/versions/') || url.includes('/projects/');
}

function pathFor(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return join(cacheDir(), `${hash}.json`);
}

function keyPath(): string {
  return join(cacheDir(), '.key');
}

/** Read the authentication key, or undefined if none exists yet. */
function loadKey(): Buffer | undefined {
  try {
    const k = readFileSync(keyPath());
    return k.length === 32 ? k : undefined;
  } catch {
    return undefined;
  }
}

/** Load or create the per-cache authentication key (stored 0600 in a 0700 dir). */
function ensureKey(): Buffer {
  const existing = loadKey();
  if (existing) return existing;
  const key = randomBytes(32);
  try {
    mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
    try { chmodSync(cacheDir(), 0o700); } catch { /* best-effort */ }
    writeFileSync(keyPath(), key, { flag: 'wx', mode: 0o600 });
    return key;
  } catch {
    // Lost a creation race, or could not write — fall back to whatever is there.
    return loadKey() ?? key;
  }
}

/** HMAC binding the entry to its URL, value, and expiry. */
function macFor(key: Buffer, url: string, expiresAt: number, value: unknown): string {
  const input = JSON.stringify({ v: SCHEMA, url, expiresAt, value });
  return createHmac('sha256', key).update(input).digest('hex');
}

function macsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/**
 * Read a cached value for `url`, or `undefined` on a miss, an expired entry, a
 * non-cacheable URL, a failed integrity check, or any read/parse error (the
 * cache is best-effort and must never throw into the audit path).
 */
export function readDisk<T>(url: string): T | undefined {
  if (!isCacheable(url)) return undefined;
  const key = loadKey();
  if (!key) return undefined; // no key → nothing trustworthy to read
  try {
    const entry = JSON.parse(readFileSync(pathFor(url), 'utf8')) as DiskEntry;
    if (entry.v !== SCHEMA || entry.url !== url) return undefined;
    if (Date.now() >= entry.expiresAt) {
      rmSync(pathFor(url), { force: true });
      return undefined;
    }
    if (!macsMatch(entry.mac, macFor(key, url, entry.expiresAt, entry.value))) {
      return undefined; // tampered or forged — do not trust
    }
    return entry.value as T;
  } catch {
    return undefined;
  }
}

/**
 * Persist a successful value for `url`. No-op for non-cacheable URLs; never
 * throws (a failed cache write must not break an audit). Writes via a temp file
 * + rename so a concurrent reader never sees a half-written entry.
 */
export function writeDisk(url: string, value: unknown): void {
  if (!isCacheable(url)) return;
  try {
    const key = ensureKey();
    const expiresAt = Date.now() + ttlMs();
    const entry: DiskEntry = { v: SCHEMA, url, expiresAt, value, mac: macFor(key, url, expiresAt, value) };
    const dest = pathFor(url);
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
    renameSync(tmp, dest);
  } catch {
    // Best-effort: ignore write failures (read-only FS, full disk, etc.).
  }
}

/** Remove the entire on-disk cache. Used by tests for isolation. */
export function clearDisk(): void {
  try {
    rmSync(cacheDir(), { recursive: true, force: true });
  } catch {
    // ignore
  }
}
