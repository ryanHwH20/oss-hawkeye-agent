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
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 24h: version-pinned deps.dev payloads are immutable, so a long TTL is safe
// and maximizes hits. Read at call time so it stays overridable for tests.
function ttlMs(): number {
  return Number(process.env.HAWKEYE_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);
}

interface DiskEntry {
  expiresAt: number;
  value: unknown;
}

/** Disk caching is on by default; set HAWKEYE_NO_CACHE to disable (e.g. tests). */
export function diskCacheEnabled(): boolean {
  return !process.env.HAWKEYE_NO_CACHE;
}

function cacheDir(): string {
  return process.env.HAWKEYE_CACHE_DIR || join(tmpdir(), 'hawkeye-cache');
}

/** Only immutable version-pinned data and advisory scorecards are cacheable. */
export function isCacheable(url: string): boolean {
  return url.includes('/versions/') || url.includes('/projects/');
}

function pathFor(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return join(cacheDir(), `${hash}.json`);
}

/**
 * Read a cached value for `url`, or `undefined` on a miss, an expired entry, a
 * non-cacheable URL, or any read/parse error (the cache is best-effort and must
 * never throw into the audit path).
 */
export function readDisk<T>(url: string): T | undefined {
  if (!isCacheable(url)) return undefined;
  try {
    const entry = JSON.parse(readFileSync(pathFor(url), 'utf8')) as DiskEntry;
    if (Date.now() >= entry.expiresAt) {
      rmSync(pathFor(url), { force: true });
      return undefined;
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
    mkdirSync(cacheDir(), { recursive: true });
    const entry: DiskEntry = { expiresAt: Date.now() + ttlMs(), value };
    const dest = pathFor(url);
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
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
