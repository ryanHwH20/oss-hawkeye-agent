import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readDisk,
  writeDisk,
  clearDisk,
  isCacheable,
  diskCacheEnabled,
} from '../src/util/disk-cache.js';
import { getVersionInfo, __resetCaches } from '../src/api/deps-dev.js';

// A version-pinned deps.dev URL (cacheable) and a project/scorecard URL.
const versionUrl = (name: string, v: string) =>
  `https://api.deps.dev/v3alpha/systems/NPM/packages/${name}/versions/${v}`;
const projectUrl = 'https://api.deps.dev/v3alpha/projects/github.com/lodash/lodash';
// The mutable package-versions list (the "latest" resolver) — NOT cacheable.
const packageListUrl = 'https://api.deps.dev/v3alpha/systems/NPM/packages/lodash';
const osvUrl = 'https://api.osv.dev/v1/query';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hawkeye-cache-test-'));
  process.env.HAWKEYE_CACHE_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HAWKEYE_CACHE_DIR;
});
afterEach(() => clearDisk());

describe('disk-cache module', () => {
  it('only treats immutable version/project URLs as cacheable', () => {
    expect(isCacheable(versionUrl('lodash', '4.17.21'))).toBe(true);
    expect(isCacheable(`${versionUrl('lodash', '4.17.21')}:dependencies`)).toBe(true);
    expect(isCacheable(projectUrl)).toBe(true);
    // Mutable / security-critical URLs must never be cached on disk.
    expect(isCacheable(packageListUrl)).toBe(false);
    expect(isCacheable(osvUrl)).toBe(false);
  });

  it('round-trips a written value', () => {
    writeDisk(versionUrl('lodash', '4.17.21'), { licenses: ['MIT'] });
    expect(readDisk(versionUrl('lodash', '4.17.21'))).toEqual({ licenses: ['MIT'] });
  });

  it('is a no-op for non-cacheable URLs', () => {
    writeDisk(packageListUrl, { versions: [{ versionKey: { version: '1.0.0' } }] });
    expect(readDisk(packageListUrl)).toBeUndefined();
  });

  it('returns undefined for an expired entry', () => {
    process.env.HAWKEYE_CACHE_TTL_MS = '0'; // expire immediately
    writeDisk(versionUrl('expired', '1.0.0'), { licenses: ['MIT'] });
    delete process.env.HAWKEYE_CACHE_TTL_MS;
    expect(readDisk(versionUrl('expired', '1.0.0'))).toBeUndefined();
  });

  it('returns undefined on a miss and never throws', () => {
    expect(readDisk(versionUrl('never-written', '9.9.9'))).toBeUndefined();
  });

  it('clearDisk removes cached entries', () => {
    writeDisk(versionUrl('lodash', '4.17.21'), { licenses: ['MIT'] });
    clearDisk();
    expect(readDisk(versionUrl('lodash', '4.17.21'))).toBeUndefined();
  });

  it('reflects HAWKEYE_NO_CACHE in diskCacheEnabled()', () => {
    expect(diskCacheEnabled()).toBe(false); // set globally in vitest.config.ts
    delete process.env.HAWKEYE_NO_CACHE;
    expect(diskCacheEnabled()).toBe(true);
    process.env.HAWKEYE_NO_CACHE = '1'; // restore
  });
});

// Prove the deps.dev fetch path actually reads and writes the disk cache. These
// need the cache enabled, so they manage HAWKEYE_NO_CACHE themselves.
describe('deps.dev disk-cache wiring', () => {
  beforeAll(() => delete process.env.HAWKEYE_NO_CACHE);
  afterAll(() => (process.env.HAWKEYE_NO_CACHE = '1'));
  beforeEach(() => __resetCaches());
  afterEach(() => vi.unstubAllGlobals());

  it('persists a fetched version payload to disk', async () => {
    const data = { versionKey: { system: 'NPM', name: 'wirepkg', version: '2.0.0' }, licenses: ['MIT'] };
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));

    const r = await getVersionInfo('NPM', 'wirepkg', '2.0.0');
    expect(r.value).toMatchObject(data);
    // A *different process* would find it on disk:
    expect(readDisk(versionUrl('wirepkg', '2.0.0'))).toMatchObject(data);
  });

  it('serves a version from disk without hitting the network', async () => {
    const seed = { versionKey: { system: 'NPM', name: 'seedpkg', version: '3.0.0' }, licenses: ['Apache-2.0'] };
    writeDisk(versionUrl('seedpkg', '3.0.0'), seed);
    // Any network call now is a failure — the disk hit must short-circuit it.
    vi.stubGlobal('fetch', async () => { throw new Error('network must not be hit'); });

    const r = await getVersionInfo('NPM', 'seedpkg', '3.0.0');
    expect(r.status).toBe('ok');
    expect(r.value).toMatchObject(seed);
  });
});
