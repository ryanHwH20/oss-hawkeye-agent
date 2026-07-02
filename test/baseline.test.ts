import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectFindings, buildBaseline, loadBaselineFingerprints, partitionFindings,
} from '../src/util/baseline.js';
import type { ScanReport } from '../src/scan/scan.js';
import type { CheckResult, Verdict, Violation } from '../src/types.js';

function result(
  name: string, version: string, verdict: Verdict,
  violations: Violation[] = [], extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    name, version, system: 'NPM', licenses: ['MIT'], rootFlaggedLicenses: [],
    advisoryCount: 0, vulnerabilities: [], osvScannerUsed: false, scorecardScore: null,
    scorecardDate: null, scorecardChecks: [], depCount: { direct: 0, indirect: 0 },
    depLicenses: [], violations, verdict, unverified: [],
    depsDevUrl: '', osvQueryUrl: '', scorecardSourceUrl: null, ...extra,
  };
}

const vuln = (reason: string): Violation => ({ type: 'VULNERABILITY', severity: 'HIGH', reason, details: [], riskExplanation: '' });
const advisory = (reason: string): Violation => ({ type: 'SCORECARD', severity: 'LOW', reason, details: [], riskExplanation: '' });

function report(results: CheckResult[]): ScanReport {
  return { path: '.', manifests: ['package.json'], results, verdict: 'BLOCKED', weakIntegrity: [] };
}

describe('collectFindings', () => {
  it('records blocked and unverified packages, but not advisories or passes', () => {
    const findings = collectFindings(report([
      result('axios', '1.7.2', 'BLOCKED', [vuln('CVE ≥ MEDIUM')]),
      result('clean', '1.0.0', 'SAFE'),
      result('advisory-only', '1.0.0', 'SAFE', [advisory('scorecard low')]),
      result('flaky', '2.0.0', 'UNKNOWN', [], { unverified: ['OSV'] }),
    ]));
    const pkgs = findings.map(f => f.package).sort();
    expect(pkgs).toEqual(['axios@1.7.2', 'flaky@2.0.0']);
    expect(findings.find(f => f.package === 'flaky@2.0.0')!.category).toBe('UNVERIFIED');
  });

  it('fingerprints on stable identifiers, not the reason prose', () => {
    const a = collectFindings(report([result('axios', '1.7.2', 'BLOCKED', [vuln('CVE-1 wording A')])]));
    const b = collectFindings(report([result('axios', '1.7.2', 'BLOCKED', [vuln('totally reworded reason')])]));
    // Same package + version + violation type ⇒ same fingerprint despite different prose.
    expect(a[0].fingerprint).toBe(b[0].fingerprint);
  });

  it('treats a new version as a new fingerprint', () => {
    const a = collectFindings(report([result('axios', '1.7.2', 'BLOCKED', [vuln('CVE')])]));
    const b = collectFindings(report([result('axios', '1.8.0', 'BLOCKED', [vuln('CVE')])]));
    expect(a[0].fingerprint).not.toBe(b[0].fingerprint);
  });
});

describe('partitionFindings', () => {
  it('splits new vs known against a baseline set', () => {
    const findings = collectFindings(report([
      result('axios', '1.7.2', 'BLOCKED', [vuln('old CVE')]),
      result('newpkg', '1.0.0', 'BLOCKED', [vuln('new CVE')]),
    ]));
    const baseline = new Set([findings.find(f => f.package === 'axios@1.7.2')!.fingerprint]);
    const { newFindings, knownFindings } = partitionFindings(findings, baseline);
    expect(knownFindings.map(f => f.package)).toEqual(['axios@1.7.2']);
    expect(newFindings.map(f => f.package)).toEqual(['newpkg@1.0.0']);
  });
});

describe('buildBaseline + loadBaselineFingerprints round-trip', () => {
  it('writes a sorted, review-friendly file that reloads to the same fingerprints', () => {
    const rep = report([
      result('zeta', '1.0.0', 'BLOCKED', [vuln('z')]),
      result('alpha', '1.0.0', 'BLOCKED', [vuln('a')]),
    ]);
    const base = buildBaseline(rep, '2026-01-01T00:00:00Z');
    expect(base.version).toBe(1);
    expect(base.generatedAt).toBe('2026-01-01T00:00:00Z');
    // Sorted by fingerprint for a stable git diff (alpha before zeta).
    expect(base.findings.map(f => f.package)).toEqual(['alpha@1.0.0', 'zeta@1.0.0']);

    const dir = mkdtempSync(join(tmpdir(), 'hawkeye-baseline-'));
    const file = join(dir, 'hawkeye-baseline.json');
    writeFileSync(file, JSON.stringify(base));
    const fps = loadBaselineFingerprints(file)!;
    const { newFindings } = partitionFindings(collectFindings(rep), fps);
    expect(newFindings).toHaveLength(0); // everything is baselined
  });

  it('returns null for a missing file (caller treats as empty)', () => {
    expect(loadBaselineFingerprints('/no/such/hawkeye-baseline.json')).toBeNull();
  });

  it('returns an empty set for a corrupt file (never silently disables the gate)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hawkeye-baseline-'));
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ not valid json');
    const fps = loadBaselineFingerprints(file)!;
    expect(fps.size).toBe(0);
  });
});
