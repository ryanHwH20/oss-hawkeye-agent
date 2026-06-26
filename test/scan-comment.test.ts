import { describe, it, expect } from 'vitest';
import { formatScanComment, PR_COMMENT_MARKER } from '../src/formatter.js';
import type { CheckResult } from '../src/types.js';
import type { ScanReport } from '../src/scan/scan.js';

function res(partial: Partial<CheckResult>): CheckResult {
  return {
    name: 'pkg', version: '1.0.0', system: 'NPM', licenses: [], rootFlaggedLicenses: [],
    advisoryCount: 0, vulnerabilities: [], osvScannerUsed: false, scorecardScore: null,
    scorecardDate: null, scorecardChecks: [], depCount: { direct: 0, indirect: 0 },
    depLicenses: [], violations: [], verdict: 'SAFE', unverified: [],
    depsDevUrl: '', osvQueryUrl: '', scorecardSourceUrl: null, ...partial,
  };
}

const report = (results: CheckResult[]): ScanReport => ({
  path: '.', manifests: ['package.json'], results,
  verdict: results.some(r => r.verdict === 'BLOCKED') ? 'BLOCKED'
    : results.some(r => r.verdict === 'UNKNOWN') ? 'UNKNOWN' : 'SAFE',
});

describe('formatScanComment', () => {
  it('always leads with the sticky marker so the bot can update in place', () => {
    expect(formatScanComment(report([res({})])).startsWith(PR_COMMENT_MARKER)).toBe(true);
  });

  it('summarizes a clean scan as passed', () => {
    const c = formatScanComment(report([res({}), res({ name: 'b' })]));
    expect(c).toContain('✅ Passed');
    expect(c).toContain('✅ 2 passed');
    expect(c).toContain('All dependencies passed');
  });

  it('lists blocked packages in a table with the reason', () => {
    const blocked = res({
      name: 'evil', version: '1.2.3', verdict: 'BLOCKED',
      violations: [{ type: 'TYPOSQUAT', severity: 'HIGH', reason: 'Possible Typosquat / Malicious Package', details: [], riskExplanation: '' }],
    });
    const c = formatScanComment(report([blocked, res({})]));
    expect(c).toContain('❌ Blocked');
    expect(c).toContain('❌ 1 blocked');
    expect(c).toContain('`evil@1.2.3`');
    expect(c).toContain('Possible Typosquat / Malicious Package');
    expect(c).not.toContain('All dependencies passed');
  });

  it('reports unverified packages as failing closed', () => {
    const unk = res({ name: 'maybe', verdict: 'UNKNOWN', unverified: ['Vulnerabilities (OSV)'] });
    const c = formatScanComment(report([unk]));
    expect(c).toContain('⚠️ Unverified');
    expect(c).toContain('Vulnerabilities (OSV)');
  });
});
