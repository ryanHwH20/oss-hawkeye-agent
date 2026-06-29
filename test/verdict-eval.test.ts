import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPackage } from '../src/checker.js';
import { __resetCaches } from '../src/api/deps-dev.js';
import type { Policy, Verdict } from '../src/types.js';

// Verdict evaluation: a labeled decision matrix spanning the whole verdict space
// (every SAFE / BLOCKED cause / UNKNOWN path), run through the real checker over
// controlled inputs. Extends the "measure, don't assert" discipline (typosquat
// eval) to the core verdict — a living spec that gates the decision logic.

const basePolicy: Policy = {
  organizationName: 'T', blockedLicenses: ['GPL-3.0-only'], minScorecardScore: 4,
  blockVulnerabilities: true, minBlockingSeverity: 'MEDIUM', blockDeprecated: true, exceptionFormUrl: '',
};

const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d });
const HIGH = 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N'; // ~7.5
const LOW = 'CVSS:3.0/AV:N/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N';  // low

interface Stub {
  name?: string; license?: string; vulns?: unknown[]; scorecard?: number | null;
  osvDown?: boolean; depsDown?: boolean; notFound?: boolean;
}

function stub(s: Stub) {
  const name = s.name ?? 'cleanpkg';
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.includes('api.osv.dev')) return s.osvDown ? { ok: false, status: 503, json: async () => ({}) } : ok({ vulns: s.vulns ?? [] });
    if (s.depsDown && u.includes('api.deps.dev')) return { ok: false, status: 500, json: async () => ({}) };
    if (s.notFound) return { ok: false, status: 404, json: async () => ({}) };
    if (u.includes(':dependencies')) return ok({ nodes: [{ versionKey: { system: 'NPM', name, version: '1.0.0' }, relation: 'SELF' }], edges: [] });
    if (u.includes('/versions/')) return ok({
      versionKey: { system: 'NPM', name, version: '1.0.0' }, licenses: [s.license ?? 'MIT'],
      ...(s.scorecard != null ? { relatedProjects: [{ projectKey: { id: 'github.com/x/y' }, relationType: 'SOURCE_REPO' }] } : {}),
    });
    if (u.includes('/projects/')) return ok({ scorecard: { date: '2026', overallScore: s.scorecard, checks: [] } });
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

const vuln = (vector: string) => ({ id: 'OSV-1', summary: 'v', severity: [{ type: 'CVSS_V3', score: vector }], affected: [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }] }] });

interface Scenario {
  label: string;
  stub: Stub;
  name?: string;
  policy?: Partial<Policy>;
  expect: Verdict;
  category?: string;
}

const SCENARIOS: Scenario[] = [
  { label: 'clean MIT package', stub: { license: 'MIT' }, expect: 'SAFE' },
  { label: 'blocked license (GPL)', stub: { license: 'GPL-3.0-only' }, expect: 'BLOCKED', category: 'LICENSE' },
  { label: 'high vuln at/above threshold', stub: { vulns: [vuln(HIGH)] }, expect: 'BLOCKED', category: 'VULNERABILITY' },
  { label: 'below-threshold vuln does not block', stub: { vulns: [vuln(LOW)] }, policy: { minBlockingSeverity: 'HIGH' }, expect: 'SAFE' },
  { label: 'known malware (MAL-)', stub: { vulns: [{ id: 'MAL-2026-1', database_specific: {} }] }, expect: 'BLOCKED', category: 'MALWARE' },
  { label: 'typosquat name', stub: { name: 'expres', license: 'MIT' }, name: 'expres', expect: 'BLOCKED', category: 'TYPOSQUAT' },
  { label: 'OSV unreachable → fail closed', stub: { osvDown: true }, expect: 'UNKNOWN' },
  { label: 'deps.dev unreachable → fail closed', stub: { depsDown: true }, expect: 'UNKNOWN' },
  { label: 'non-existent package → fail closed', stub: { notFound: true }, expect: 'UNKNOWN' },
  { label: 'low scorecard is advisory, not blocking', stub: { license: 'MIT', scorecard: 1.0 }, expect: 'SAFE' },
];

afterEach(() => { vi.unstubAllGlobals(); __resetCaches(); });

describe('verdict evaluation — decision matrix', () => {
  it('every labeled scenario produces the correct verdict (100% required)', async () => {
    const results: Array<{ label: string; ok: boolean; got: Verdict; want: Verdict }> = [];
    for (const s of SCENARIOS) {
      stub(s.stub);
      const r = await checkPackage('NPM', s.name ?? s.stub.name ?? 'cleanpkg', '1.0.0', { ...basePolicy, ...s.policy });
      const verdictOk = r.verdict === s.expect;
      const catOk = !s.category || r.violations.some(v => v.type === s.category);
      results.push({ label: s.label, ok: verdictOk && catOk, got: r.verdict, want: s.expect });
      vi.unstubAllGlobals();
      __resetCaches();
    }

    const passed = results.filter(r => r.ok).length;
    // eslint-disable-next-line no-console
    console.log(
      `\n  Verdict eval: ${passed}/${results.length} decisions correct` +
        results.filter(r => !r.ok).map(r => `\n  ✗ ${r.label}: got ${r.got}, want ${r.want}`).join('')
    );
    expect(passed).toBe(results.length);
  });
});
