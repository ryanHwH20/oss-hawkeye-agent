import { describe, it, expect } from 'vitest';
import { formatInstallPlan, buildInstallCommand } from '../src/formatter.js';
import type { CommandAudit } from '../src/command.js';
import type { CheckResult, Verdict, Violation } from '../src/types.js';

/** Minimal CheckResult builder — only the fields the plan formatter reads. */
function result(
  name: string,
  version: string,
  verdict: Verdict,
  violations: Violation[] = [],
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    name, version, system: 'NPM', licenses: ['MIT'], rootFlaggedLicenses: [],
    advisoryCount: 0, vulnerabilities: [], osvScannerUsed: false, scorecardScore: null,
    scorecardDate: null, scorecardChecks: [], depCount: { direct: 0, indirect: 0 },
    depLicenses: [], violations, verdict, unverified: [],
    depsDevUrl: '', osvQueryUrl: '', scorecardSourceUrl: null, ...extra,
  };
}

const vuln = (reason: string): Violation => ({
  type: 'VULNERABILITY', severity: 'HIGH', reason, details: [], riskExplanation: '',
});

function audit(partial: Partial<CommandAudit>): CommandAudit {
  return {
    detected: true, command: 'npm install', system: 'NPM', results: [],
    verdict: 'SAFE', effectiveVerdict: 'SAFE', overrides: [], remediation: [], ...partial,
  };
}

describe('buildInstallCommand', () => {
  it('combines npm packages onto one install line', () => {
    expect(buildInstallCommand('NPM', [
      { name: 'axios', version: '1.16.0' }, { name: 'ws', version: '8.21.0' },
    ])).toBe('npm install axios@1.16.0 ws@8.21.0');
  });

  it('preserves the developer’s package manager (yarn/pnpm/bun use add)', () => {
    expect(buildInstallCommand('NPM', [{ name: 'axios', version: '1.16.0' }], 'yarn'))
      .toBe('yarn add axios@1.16.0');
    expect(buildInstallCommand('NPM', [{ name: 'axios', version: '1.16.0' }], 'pnpm'))
      .toBe('pnpm add axios@1.16.0');
  });

  it('uses ecosystem-correct version syntax', () => {
    expect(buildInstallCommand('PYPI', [{ name: 'requests', version: '2.32.0' }]))
      .toBe('pip install requests==2.32.0');
    expect(buildInstallCommand('GO', [{ name: 'example.com/mod', version: '1.2.3' }]))
      .toBe('go get example.com/mod@v1.2.3');
  });

  it('emits one line per package for managers that cannot combine versions', () => {
    expect(buildInstallCommand('RUBYGEMS', [
      { name: 'rack', version: '3.1.0' }, { name: 'puma', version: '6.0.0' },
    ])).toBe('gem install rack -v 3.1.0\ngem install puma -v 6.0.0');
  });

  it('returns empty string when there is nothing to install', () => {
    expect(buildInstallCommand('NPM', [])).toBe('');
  });
});

describe('formatInstallPlan', () => {
  it('leads with a scannable plan table for every requested package', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install axios@1.7.2 lodash@4.17.21',
      results: [
        result('axios', '1.7.2', 'BLOCKED', [vuln('CVE-2025-0001 SSRF')]),
        result('lodash', '4.17.21', 'SAFE'),
      ],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{
        name: 'axios', system: 'NPM', current: '1.7.2', action: 'upgrade',
        recommendedVersion: '1.16.0', fix: 'axios@1.16.0', verified: true, reason: 'patched in 1.16.0',
      }],
    }));
    expect(out).toContain('## Install Plan');
    expect(out).toContain('| `axios` | `1.7.2` | ❌ Blocked | → `1.16.0` | CVE-2025-0001 SSRF |');
    expect(out).toContain('| `lodash` | `4.17.21` | ✅ Pass | ✅ install |');
  });

  it('generates one consolidated safe install command with fixes applied', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install axios@1.7.2 lodash@4.17.21',
      results: [
        result('axios', '1.7.2', 'BLOCKED', [vuln('CVE')]),
        result('lodash', '4.17.21', 'SAFE'),
      ],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{
        name: 'axios', system: 'NPM', current: '1.7.2', action: 'upgrade',
        recommendedVersion: '1.16.0', fix: 'axios@1.16.0', verified: true, reason: 'patched',
      }],
    }));
    expect(out).toContain('## ✅ Safe install command');
    // Blocked axios is pinned to its patched version; the clean lodash is kept as-is.
    expect(out).toContain('npm install axios@1.16.0 lodash@4.17.21');
  });

  it('never puts an un-fixable package in the command; lists it as manual and marks the command partial', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install axios@1.7.2 evil-pkg',
      results: [
        result('axios', '1.7.2', 'BLOCKED', [vuln('CVE')]),
        result('evil-pkg', '', 'BLOCKED', [{ type: 'MALWARE', severity: 'HIGH', reason: 'known malware', details: [], riskExplanation: '' }]),
      ],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [
        { name: 'axios', system: 'NPM', current: '1.7.2', action: 'upgrade', recommendedVersion: '1.16.0', fix: 'axios@1.16.0', verified: true, reason: 'patched' },
        { name: 'evil-pkg', system: 'NPM', current: '', action: 'find-alternative', recommendedVersion: null, fix: null, reason: 'known-malicious; choose a trusted alternative' },
      ],
    }));
    // The install command pins only the fixable package; evil-pkg is excluded.
    expect(out).toContain('```bash\nnpm install axios@1.16.0\n```');
    expect(out).toContain('Resolves 1 of 2 packages');
    expect(out).toContain('## ⛔ Needs manual attention');
    expect(out).toContain('- `evil-pkg@latest` — known-malicious; choose a trusted alternative');
  });

  it('says all approved when nothing needs changing', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install lodash@4.17.21',
      results: [result('lodash', '4.17.21', 'SAFE')],
    }));
    expect(out).toContain('✅ All packages approved — install as requested.');
    expect(out).not.toContain('Safe install command');
  });

  it('shows no safe command when every package is un-fixable', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install evil-pkg',
      results: [result('evil-pkg', '', 'BLOCKED', [{ type: 'MALWARE', severity: 'HIGH', reason: 'malware', details: [], riskExplanation: '' }])],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{ name: 'evil-pkg', system: 'NPM', current: '', action: 'find-alternative', recommendedVersion: null, fix: null, reason: 'no safe version' }],
    }));
    expect(out).toContain('## ⛔ No safe install command');
    expect(out).toContain('## ⛔ Needs manual attention');
  });

  it('surfaces documented exceptions as installable-with-warning', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install gplpkg@1.0.0',
      results: [result('gplpkg', '1.0.0', 'BLOCKED', [{ type: 'LICENSE', severity: 'HIGH', reason: 'GPL-3.0', details: [], riskExplanation: '' }])],
      verdict: 'BLOCKED', effectiveVerdict: 'SAFE',
      overrides: [{ name: 'gplpkg', version: '1.0.0', originalVerdict: 'BLOCKED', reason: 'legacy migration', approvedBy: 'sec' }],
    }));
    expect(out).toContain('⚠️ exception');
    expect(out).toContain('## ⚠️ Allowed via documented exception');
    expect(out).toContain('risk accepted: legacy migration');
    // An overridden package is still installable as requested.
    expect(out).toContain('npm install gplpkg@1.0.0');
  });

  it('escapes pipes so a reason cannot break the table', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install weird@1.0.0',
      results: [result('weird', '1.0.0', 'BLOCKED', [vuln('a | b | c')])],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{ name: 'weird', system: 'NPM', current: '1.0.0', action: 'find-alternative', recommendedVersion: null, fix: null, reason: 'x' }],
    }));
    expect(out).toContain('a \\| b \\| c');
  });

  it('escapes backslashes before pipes so the escaping is complete', () => {
    const out = formatInstallPlan(audit({
      command: 'npm install weird@1.0.0',
      results: [result('weird', '1.0.0', 'BLOCKED', [vuln('path C:\\x | y')])],
      verdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{ name: 'weird', system: 'NPM', current: '1.0.0', action: 'find-alternative', recommendedVersion: null, fix: null, reason: 'x' }],
    }));
    // Backslash doubled, then the literal pipe escaped — no lone `\|` from input.
    expect(out).toContain('path C:\\\\x \\| y');
  });
});
