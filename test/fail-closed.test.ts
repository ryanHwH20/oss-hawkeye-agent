import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPackage } from '../src/checker.js';
import { formatResult } from '../src/formatter.js';
import type { Policy } from '../src/types.js';

const policy: Policy = {
  organizationName: 'Test Org',
  blockedLicenses: ['GPL-3.0-only'],
  minScorecardScore: 4,
  blockVulnerabilities: true,
  blockDeprecated: true,
  exceptionFormUrl: '',
  ai: null,
};

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
}

function jsonResponse(data: unknown, init: FakeResponseInit = {}): unknown {
  const { ok = true, status = 200 } = init;
  return { ok, status, json: async () => data };
}

/**
 * A deps.dev response that resolves cleanly to an MIT-licensed package with no
 * dependencies and no source repo (so no scorecard) — the "everything fine on
 * deps.dev" baseline. Tests vary only the OSV / deps.dev availability.
 */
function depsDevHappy(name: string, url: string): unknown {
  if (url.includes(':dependencies')) {
    return jsonResponse({
      nodes: [{ versionKey: { system: 'NPM', name, version: '1.0.0' }, relation: 'SELF' }],
      edges: [],
    });
  }
  if (url.includes('/versions/')) {
    return jsonResponse({ versionKey: { system: 'NPM', name, version: '1.0.0' }, licenses: ['MIT'] });
  }
  return jsonResponse({}, { ok: false, status: 404 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fail-closed verdict (issue #7)', () => {
  it('fails closed (UNKNOWN) when OSV is unreachable, and never claims the package is clean', async () => {
    const name = 'osv-down-pkg';
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) return jsonResponse({}, { ok: false, status: 503 });
      return depsDevHappy(name, u);
    });

    const r = await checkPackage('NPM', name, '1.0.0', policy);

    expect(r.verdict).toBe('UNKNOWN');
    expect(r.unverified).toContain('Vulnerabilities (OSV)');

    const report = formatResult(r);
    // The cardinal sin: it must NOT report "no vulnerabilities" when blind.
    expect(report).not.toContain('No known vulnerabilities');
    expect(report).toContain('UNVERIFIED');
  });

  it('treats OSV 429 rate-limiting as unavailable, not as "no vulnerabilities"', async () => {
    const name = 'rate-limited-pkg';
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) return jsonResponse({}, { ok: false, status: 429 });
      return depsDevHappy(name, u);
    });

    const r = await checkPackage('NPM', name, '1.0.0', policy);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.unverified).toContain('Vulnerabilities (OSV)');
  });

  it('fails closed (UNKNOWN) when deps.dev package metadata is unreachable', async () => {
    const name = 'depsdev-down-pkg';
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) return jsonResponse({ vulns: [] });
      if (u.includes('api.deps.dev')) return jsonResponse({}, { ok: false, status: 500 });
      return jsonResponse({}, { ok: false, status: 404 });
    });

    const r = await checkPackage('NPM', name, '1.0.0', policy);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.unverified).toContain('Package metadata & licenses (deps.dev)');
  });

  it('returns SAFE when every source is reachable and the package is clean', async () => {
    const name = 'clean-pkg';
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) return jsonResponse({ vulns: [] });
      return depsDevHappy(name, u);
    });

    const r = await checkPackage('NPM', name, '1.0.0', policy);

    expect(r.verdict).toBe('SAFE');
    expect(r.unverified).toEqual([]);
    expect(formatResult(r)).toContain('No known vulnerabilities');
  });

  it('still BLOCKS on a real policy violation (regression)', async () => {
    const name = 'gpl-pkg';
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) return jsonResponse({ vulns: [] });
      if (u.includes(':dependencies')) {
        return jsonResponse({
          nodes: [{ versionKey: { system: 'NPM', name, version: '1.0.0' }, relation: 'SELF' }],
          edges: [],
        });
      }
      if (u.includes('/versions/')) {
        return jsonResponse({ versionKey: { system: 'NPM', name, version: '1.0.0' }, licenses: ['GPL-3.0-only'] });
      }
      return jsonResponse({}, { ok: false, status: 404 });
    });

    const r = await checkPackage('NPM', name, '1.0.0', policy);
    expect(r.verdict).toBe('BLOCKED');
  });
});
