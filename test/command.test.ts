import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { auditCommand } from '../src/command.js';
import { __resetCaches } from '../src/api/deps-dev.js';
import type { Policy } from '../src/types.js';

const policy: Policy = {
  organizationName: 'Test',
  blockedLicenses: ['GPL-3.0-only'],
  minScorecardScore: 4,
  blockVulnerabilities: true,
  minBlockingSeverity: 'MEDIUM',
  blockDeprecated: true,
  exceptionFormUrl: '',
};

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

function stubPackage(name: string, license: string) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
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

// A HIGH-severity CVSS vector (base ~7.5) so the vuln crosses the block threshold.
const HIGH_VECTOR = 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N';
const verOf = (url: string) => url.match(/\/versions\/([^/:]+)/)?.[1] ?? '';

/**
 * Stub where a package's vulnerability depends on the *version* being audited,
 * so we can drive the verify-before-recommend path: `fixedByVersion[v]` gives
 * the fixed versions to advertise for version `v`; a version absent from the
 * map audits clean. The (single, SELF-only) dependency graph keeps OSV on the
 * `/query` path so we branch on the request body's version.
 */
function stubVersioned(name: string, fixedByVersion: Record<string, string[]>) {
  vi.stubGlobal('fetch', async (url: string, opts?: { body?: string }) => {
    const u = String(url);
    if (u.includes('api.osv.dev')) {
      const ver = opts?.body ? JSON.parse(opts.body).version : '';
      const fixed = fixedByVersion[ver];
      if (!fixed) return ok({ vulns: [] });
      return ok({
        vulns: [{
          id: 'OSV-TEST-1',
          summary: 'test vuln',
          severity: [{ type: 'CVSS_V3', score: HIGH_VECTOR }],
          affected: [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: fixed[0] }] }] }],
        }],
      });
    }
    if (u.includes(':dependencies')) {
      return ok({ nodes: [{ versionKey: { system: 'NPM', name, version: verOf(u) }, relation: 'SELF' }], edges: [] });
    }
    if (u.includes('/versions/')) {
      return ok({ versionKey: { system: 'NPM', name, version: verOf(u) }, licenses: ['MIT'] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

beforeEach(() => __resetCaches());
afterEach(() => vi.unstubAllGlobals());

describe('auditCommand — install guardrail (issue #26)', () => {
  it('reports detected:false for a non-install command', async () => {
    const a = await auditCommand('ls -la', policy);
    expect(a.detected).toBe(false);
    expect(a.verdict).toBe('SAFE');
    expect(a.results).toHaveLength(0);
  });

  it('parses the ecosystem and BLOCKS a policy-violating install', async () => {
    stubPackage('gplpkg', 'GPL-3.0-only');
    const a = await auditCommand('npm install gplpkg@1.0.0', policy);
    expect(a.detected).toBe(true);
    expect(a.system).toBe('NPM');
    expect(a.verdict).toBe('BLOCKED');
    // A blocked install carries machine-actionable remediation for the agent.
    expect(a.remediation).toHaveLength(1);
    expect(a.remediation[0].action).toBe('find-alternative');
  });

  it('APPROVES a clean install', async () => {
    stubPackage('cleanpkg', 'MIT');
    const a = await auditCommand('npm install cleanpkg@1.0.0', policy);
    expect(a.detected).toBe(true);
    expect(a.verdict).toBe('SAFE');
  });

  it('recommends a verified-clean upgrade for a fixable vulnerability', async () => {
    // 1.0.0 is vulnerable (fixed in 2.0.0); 2.0.0 audits clean.
    stubVersioned('vulnpkg', { '1.0.0': ['2.0.0'] });
    const a = await auditCommand('npm install vulnpkg@1.0.0', policy);
    expect(a.verdict).toBe('BLOCKED');
    expect(a.remediation).toHaveLength(1);
    expect(a.remediation[0].action).toBe('upgrade');
    expect(a.remediation[0].fix).toBe('vulnpkg@2.0.0');
    expect(a.remediation[0].verified).toBe(true);
  });

  it('never recommends a "fix" that is itself blocked — degrades honestly', async () => {
    // 1.0.0 is vulnerable and "fixed" in 2.0.0, but 2.0.0 is ALSO vulnerable.
    stubVersioned('stubbornpkg', { '1.0.0': ['2.0.0'], '2.0.0': ['3.0.0'] });
    const a = await auditCommand('npm install stubbornpkg@1.0.0', policy);
    expect(a.remediation[0].action).toBe('find-alternative');
    expect(a.remediation[0].fix).toBeNull();
    expect(a.remediation[0].verified).toBe(false);
    expect(a.remediation[0].reason).toContain('does not pass audit');
  });

  it('fails closed (UNKNOWN) when a source is unreachable', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) return { ok: false, status: 503, json: async () => ({}) };
      if (u.includes(':dependencies')) return ok({ nodes: [{ versionKey: { system: 'NPM', name: 'x', version: '1.0.0' }, relation: 'SELF' }], edges: [] });
      if (u.includes('/versions/')) return ok({ versionKey: { system: 'NPM', name: 'x', version: '1.0.0' }, licenses: ['MIT'] });
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const a = await auditCommand('npm install x@1.0.0', policy);
    expect(a.verdict).toBe('UNKNOWN');
  });
});
