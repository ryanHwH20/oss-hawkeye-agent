import { describe, it, expect } from 'vitest';
import { formatPrNote } from '../src/formatter.js';
import type { CommandAudit } from '../src/command.js';
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

function audit(partial: Partial<CommandAudit>): CommandAudit {
  return {
    detected: true, command: 'npm install', system: 'NPM', results: [],
    verdict: 'SAFE', effectiveVerdict: 'SAFE', overrides: [], remediation: [], ...partial,
  };
}

describe('formatPrNote', () => {
  it('documents risk, the version fix, compatibility, and a test checklist', () => {
    const out = formatPrNote(audit({
      command: 'npm install axios@1.7.2',
      results: [result('axios', '1.7.2', 'BLOCKED', [vuln('Known Vulnerability ≥ MEDIUM')])],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{ name: 'axios', system: 'NPM', current: '1.7.2', action: 'upgrade', recommendedVersion: '1.16.0', fix: 'axios@1.16.0', verified: true, reason: 'patched' }],
    }));
    expect(out).toContain('### Risk summary');
    expect(out).toContain('- `axios@1.7.2` — Known Vulnerability ≥ MEDIUM');
    expect(out).toContain('| `axios` | `1.7.2` | `1.16.0` |');
    expect(out).toContain('### Compatibility');
    expect(out).toContain('### Testing');
    expect(out).toContain('Smoke-test the paths that use `axios`');
  });

  it('flags a major bump as breaking and adds a review checkbox', () => {
    const out = formatPrNote(audit({
      command: 'npm install lib@1.2.3',
      results: [result('lib', '1.2.3', 'BLOCKED', [vuln('CVE')])],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{ name: 'lib', system: 'NPM', current: '1.2.3', action: 'upgrade', recommendedVersion: '2.0.0', fix: 'lib@2.0.0', verified: true, reason: 'patched' }],
    }));
    expect(out).toContain('Major');
    expect(out).toContain('Review breaking-change notes');
  });

  it('labels a patch bump as a drop-in fix', () => {
    const out = formatPrNote(audit({
      command: 'npm install lib@1.2.3',
      results: [result('lib', '1.2.3', 'BLOCKED', [vuln('CVE')])],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{ name: 'lib', system: 'NPM', current: '1.2.3', action: 'upgrade', recommendedVersion: '1.2.4', fix: 'lib@1.2.4', verified: true, reason: 'patched' }],
    }));
    expect(out).toContain('Patch bump — drop-in fix.');
    expect(out).not.toContain('Review breaking-change notes');
  });

  it('separates packages with no safe upgrade into manual attention', () => {
    const out = formatPrNote(audit({
      command: 'npm install evil',
      results: [result('evil', '', 'BLOCKED', [{ type: 'MALWARE', severity: 'HIGH', reason: 'known malware', details: [], riskExplanation: '' }])],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{ name: 'evil', system: 'NPM', current: '', action: 'find-alternative', recommendedVersion: null, fix: null, reason: 'no safe version — choose an alternative' }],
    }));
    expect(out).toContain('### ⛔ Still needs manual attention');
    expect(out).toContain('- `evil@latest` — no safe version — choose an alternative');
    expect(out).not.toContain('### Applied fix');
  });

  it('excludes exception-approved packages from the change note', () => {
    const out = formatPrNote(audit({
      command: 'npm install gplpkg@1.0.0',
      results: [result('gplpkg', '1.0.0', 'BLOCKED', [{ type: 'LICENSE', severity: 'HIGH', reason: 'GPL', details: [], riskExplanation: '' }])],
      verdict: 'BLOCKED', effectiveVerdict: 'SAFE',
      overrides: [{ name: 'gplpkg', version: '1.0.0', originalVerdict: 'BLOCKED', reason: 'legacy', approvedBy: 'sec' }],
    }));
    // Nothing left to justify → the "all passed" note.
    expect(out).toContain('No security-blocking changes were required.');
  });

  it('returns a clean note when nothing was blocked', () => {
    const out = formatPrNote(audit({
      command: 'npm install lodash@4.18.0',
      results: [result('lodash', '4.18.0', 'SAFE')],
    }));
    expect(out).toContain("passed Hawkeye's supply-chain audit");
  });
});
