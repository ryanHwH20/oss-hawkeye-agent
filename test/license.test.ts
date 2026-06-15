import { describe, it, expect, vi, afterEach } from 'vitest';
import { flaggedLicenses } from '../src/util/license.js';
import { checkPackage } from '../src/checker.js';
import type { Policy } from '../src/types.js';

const BLOCKED = ['GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only'];

describe('flaggedLicenses — SPDX expressions (issue #12)', () => {
  it('flags a plain blocked license id', () => {
    expect(flaggedLicenses(['GPL-3.0-only'], BLOCKED)).toEqual(['GPL-3.0-only']);
  });

  it('does not flag a permissive license', () => {
    expect(flaggedLicenses(['MIT'], BLOCKED)).toEqual([]);
    expect(flaggedLicenses(['Apache-2.0'], BLOCKED)).toEqual([]);
  });

  it('does NOT flag an OR expression when a compliant choice exists', () => {
    // You can satisfy this with MIT, so it is not forced copyleft.
    expect(flaggedLicenses(['(MIT OR GPL-3.0-only)'], BLOCKED)).toEqual([]);
  });

  it('flags an OR expression only when every branch is blocked', () => {
    expect(flaggedLicenses(['(GPL-2.0-only OR GPL-3.0-only)'], BLOCKED).sort())
      .toEqual(['GPL-2.0-only', 'GPL-3.0-only']);
  });

  it('flags an AND expression when any side is blocked', () => {
    // You must comply with both, so the blocked side taints the whole thing.
    expect(flaggedLicenses(['MIT AND GPL-3.0-only'], BLOCKED)).toEqual(['GPL-3.0-only']);
  });

  it('falls back to exact match for non-SPDX strings', () => {
    expect(flaggedLicenses(['SEE LICENSE IN FILE'], BLOCKED)).toEqual([]);
    expect(flaggedLicenses(['GPL-3.0-only'], ['GPL-3.0-only'])).toEqual(['GPL-3.0-only']);
  });
});

// ── Integration: SPDX matching drives the verdict ────────────────────────────

function policy(): Policy {
  return {
    organizationName: 'Test',
    blockedLicenses: ['GPL-3.0-only'],
    minScorecardScore: 4,
    blockVulnerabilities: true,
    minBlockingSeverity: 'MEDIUM',
    blockDeprecated: true,
    exceptionFormUrl: '',
  };
}

function stubPackage(name: string, license: string) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (u.includes('api.osv.dev')) return ok({ vulns: [] });
    if (u.includes(':dependencies')) {
      return ok({ nodes: [{ versionKey: { system: 'NPM', name, version: '1.0.0' }, relation: 'SELF' }], edges: [] });
    }
    if (u.includes('/versions/')) {
      return ok({ versionKey: { system: 'NPM', name, version: '1.0.0' }, licenses: [license] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SPDX license matching — end to end (issue #12)', () => {
  it('does not block a dual license you can satisfy permissively', async () => {
    stubPackage('dual-pkg', '(MIT OR GPL-3.0-only)');
    const r = await checkPackage('NPM', 'dual-pkg', '1.0.0', policy());
    expect(r.rootFlaggedLicenses).toEqual([]);
    expect(r.verdict).toBe('SAFE');
  });

  it('blocks a package that forces a blocked license via AND', async () => {
    stubPackage('and-pkg', 'MIT AND GPL-3.0-only');
    const r = await checkPackage('NPM', 'and-pkg', '1.0.0', policy());
    expect(r.rootFlaggedLicenses).toEqual(['GPL-3.0-only']);
    expect(r.verdict).toBe('BLOCKED');
  });
});
