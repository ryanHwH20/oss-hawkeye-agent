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
  });

  it('APPROVES a clean install', async () => {
    stubPackage('cleanpkg', 'MIT');
    const a = await auditCommand('npm install cleanpkg@1.0.0', policy);
    expect(a.detected).toBe(true);
    expect(a.verdict).toBe('SAFE');
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
