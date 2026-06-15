import { describe, it, expect, vi, afterEach } from 'vitest';
import { meetsBlockingThreshold, severityRank } from '../src/util/severity.js';
import { checkPackage } from '../src/checker.js';
import type { Policy } from '../src/types.js';

describe('meetsBlockingThreshold (issue #13)', () => {
  it('ranks severities in order', () => {
    expect(severityRank('CRITICAL')).toBeGreaterThan(severityRank('HIGH'));
    expect(severityRank('HIGH')).toBeGreaterThan(severityRank('MEDIUM'));
    expect(severityRank('MEDIUM')).toBeGreaterThan(severityRank('LOW'));
    expect(severityRank('UNKNOWN')).toBe(0);
  });

  it('blocks at or above the threshold', () => {
    expect(meetsBlockingThreshold('HIGH', 'HIGH')).toBe(true);
    expect(meetsBlockingThreshold('CRITICAL', 'HIGH')).toBe(true);
    expect(meetsBlockingThreshold('MEDIUM', 'HIGH')).toBe(false);
    expect(meetsBlockingThreshold('UNKNOWN', 'LOW')).toBe(false);
  });
});

// ── Integration: the threshold actually changes the verdict ──────────────────

function policyWith(minBlockingSeverity: Policy['minBlockingSeverity']): Policy {
  return {
    organizationName: 'Test Org',
    blockedLicenses: [],
    minScorecardScore: 4,
    blockVulnerabilities: true,
    minBlockingSeverity,
    blockDeprecated: true,
    exceptionFormUrl: '',
  };
}

// A CVSS 7.5 vector → HIGH severity.
const HIGH_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N';

function stubHighVulnPackage(name: string) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (u.includes('api.osv.dev')) {
      return ok({ vulns: [{ id: 'OSV-HIGH', severity: [{ type: 'CVSS_V3', score: HIGH_VECTOR }], affected: [] }] });
    }
    if (u.includes(':dependencies')) {
      return ok({ nodes: [{ versionKey: { system: 'NPM', name, version: '1.0.0' }, relation: 'SELF' }], edges: [] });
    }
    if (u.includes('/versions/')) {
      return ok({ versionKey: { system: 'NPM', name, version: '1.0.0' }, licenses: ['MIT'] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('configurable severity threshold — end to end (issue #13)', () => {
  it('BLOCKS a HIGH vuln when the threshold is HIGH', async () => {
    stubHighVulnPackage('high-pkg-a');
    const r = await checkPackage('NPM', 'high-pkg-a', '1.0.0', policyWith('HIGH'));
    expect(r.verdict).toBe('BLOCKED');
    expect(r.violations.some(v => v.type === 'VULNERABILITY')).toBe(true);
  });

  it('does NOT block the same HIGH vuln when the threshold is CRITICAL', async () => {
    stubHighVulnPackage('high-pkg-b');
    const r = await checkPackage('NPM', 'high-pkg-b', '1.0.0', policyWith('CRITICAL'));
    expect(r.verdict).toBe('SAFE');
    expect(r.violations.some(v => v.type === 'VULNERABILITY')).toBe(false);
  });
});
