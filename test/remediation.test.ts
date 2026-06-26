import { describe, it, expect } from 'vitest';
import { findSmartUpgrades, remediatePackage } from '../src/util/remediation.js';
import type { CheckResult, Violation } from '../src/types.js';

function mk(partial: Partial<CheckResult>): CheckResult {
  return {
    name: 'pkg',
    version: '1.0.0',
    system: 'NPM',
    licenses: [],
    rootFlaggedLicenses: [],
    advisoryCount: 0,
    vulnerabilities: [],
    osvScannerUsed: false,
    scorecardScore: null,
    scorecardDate: null,
    scorecardChecks: [],
    depCount: { direct: 0, indirect: 0 },
    depLicenses: [],
    violations: [],
    verdict: 'BLOCKED',
    unverified: [],
    depsDevUrl: '',
    osvQueryUrl: '',
    scorecardSourceUrl: null,
    ...partial,
  };
}

const vuln = (fixedVersions: string[]): Violation => ({
  type: 'VULNERABILITY',
  severity: 'HIGH',
  reason: 'Known Vulnerability',
  details: ['CVE-2024-0001 (HIGH · CVSS 7.5)'],
  riskExplanation: '',
  fixedVersions,
});

describe('remediatePackage (issue #26 — agent self-correction)', () => {
  it('recommends a concrete patched version for a root vulnerability', () => {
    const r = remediatePackage(mk({ name: 'express', version: '4.16.0', violations: [vuln(['4.20.0', '4.21.2'])] }));
    expect(r.action).toBe('upgrade');
    expect(r.recommendedVersion).toBe('4.21.2');
    expect(r.fix).toBe('express@4.21.2');
    expect(r.reason).toContain('CVE-2024-0001');
  });

  it('recommends the highest fixed version so every CVE is provably cleared', () => {
    // 1.2.5 might fix only one CVE; 2.0.0 is ≥ every fix, so it is the safe pick
    // even though it is a larger jump. Security correctness over convenience.
    const r = remediatePackage(mk({ version: '1.2.3', violations: [vuln(['1.2.5', '2.0.0'])] }));
    expect(r.recommendedVersion).toBe('2.0.0');
    expect(r.fix).toBe('pkg@2.0.0');
  });

  it('routes to find-alternative when a vulnerable package has no fix', () => {
    const r = remediatePackage(mk({ violations: [vuln([])] }));
    expect(r.action).toBe('find-alternative');
    expect(r.fix).toBeNull();
  });

  it('routes a blocked license to find-alternative (no version swap helps)', () => {
    const lic: Violation = {
      type: 'LICENSE', severity: 'HIGH', reason: 'License Blocked',
      details: ['GPL-3.0-only'], riskExplanation: '',
    };
    const r = remediatePackage(mk({ name: 'copyleftlib', violations: [lic] }));
    expect(r.action).toBe('find-alternative');
    expect(r.fix).toBeNull();
    expect(r.reason).toContain('GPL-3.0-only');
  });

  it('surfaces the offending transitive dependency rather than a misleading upgrade', () => {
    const sbom: Violation = {
      type: 'SBOM_VULNERABILITY', severity: 'HIGH', reason: 'Transitive Dependency Vulnerability',
      details: ['CVE-2024-9999'], riskExplanation: '', affectedDep: 'badlib@1.0.0',
    };
    const r = remediatePackage(mk({ name: 'roots', violations: [sbom] }));
    expect(r.action).toBe('find-alternative');
    expect(r.fix).toBeNull();
    expect(r.reason).toContain('badlib@1.0.0');
  });

  it('tells the caller to verify, not install, an unverifiable package', () => {
    const r = remediatePackage(mk({ verdict: 'UNKNOWN', unverified: ['Vulnerabilities (OSV)'] }));
    expect(r.action).toBe('verify');
    expect(r.fix).toBeNull();
    expect(r.reason).toContain('Vulnerabilities (OSV)');
  });
});

describe('findSmartUpgrades (moved from formatter, behavior preserved)', () => {
  it('handles non-semver versions by returning the last fixed version', () => {
    expect(findSmartUpgrades('3.5.8.RELEASE', ['3.5.9.RELEASE'])).toEqual({
      minimal: '3.5.9.RELEASE', latest: '3.5.9.RELEASE',
    });
  });

  it('returns nulls when there are no fixed versions', () => {
    expect(findSmartUpgrades('1.0.0', [])).toEqual({ minimal: null, latest: null });
  });
});
