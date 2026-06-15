import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanProject } from '../src/scan/scan.js';
import { __resetCaches } from '../src/api/deps-dev.js';
import type { Policy } from '../src/types.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'scan-project');

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

beforeEach(() => {
  __resetCaches(); // isolate the shared deps.dev cache between cases
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scanProject (issue #23)', () => {
  it('audits every manifest dependency and aggregates to BLOCKED when any is blocked', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) return ok({ vulns: [] });
      const isGpl = u.includes('/gplpkg/');
      const name = isGpl ? 'gplpkg' : 'cleanpkg';
      if (u.includes(':dependencies')) {
        return ok({ nodes: [{ versionKey: { system: 'NPM', name, version: '1.0.0' }, relation: 'SELF' }], edges: [] });
      }
      if (u.includes('/versions/')) {
        return ok({ versionKey: { system: 'NPM', name, version: '1.0.0' }, licenses: [isGpl ? 'GPL-3.0-only' : 'MIT'] });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const report = await scanProject(FIXTURE, policy);

    expect(report.manifests).toContain('package.json');
    expect(report.results).toHaveLength(2);
    expect(report.verdict).toBe('BLOCKED');
    expect(report.results.find(r => r.name === 'gplpkg')?.verdict).toBe('BLOCKED');
    expect(report.results.find(r => r.name === 'cleanpkg')?.verdict).toBe('SAFE');
  });

  it('aggregates to UNKNOWN (fail-closed) when a source is unreachable and nothing is blocked', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      // OSV down for everything; deps.dev clean → no block, but unverifiable.
      if (u.includes('api.osv.dev')) return { ok: false, status: 503, json: async () => ({}) };
      const name = u.includes('/gplpkg/') ? 'gplpkg' : 'cleanpkg';
      if (u.includes(':dependencies')) {
        return ok({ nodes: [{ versionKey: { system: 'NPM', name, version: '1.0.0' }, relation: 'SELF' }], edges: [] });
      }
      if (u.includes('/versions/')) {
        return ok({ versionKey: { system: 'NPM', name, version: '1.0.0' }, licenses: ['MIT'] });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const report = await scanProject(FIXTURE, policy);
    expect(report.verdict).toBe('UNKNOWN');
  });
});
