import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult, Policy, Violation } from '../../src/types.js';

const checkPackage = vi.fn();
const checkPackages = vi.fn();

vi.mock('../../src/checker.js', () => ({ checkPackage, checkPackages }));

const { assessAction } = await import('../../src/runtime/assess-action.js');

const policy: Policy = {
  organizationName: 'Test',
  blockedLicenses: ['GPL-3.0-only'],
  minScorecardScore: 4,
  blockVulnerabilities: true,
  minBlockingSeverity: 'MEDIUM',
  blockDeprecated: true,
  blockTyposquats: true,
  exceptionFormUrl: '',
};

function result(partial: Partial<CheckResult> = {}): CheckResult {
  return {
    name: 'lodash', version: '4.17.21', system: 'NPM', licenses: ['MIT'],
    rootFlaggedLicenses: [], advisoryCount: 0, vulnerabilities: [], osvScannerUsed: false,
    scorecardScore: null, scorecardDate: null, scorecardChecks: [],
    depCount: { direct: 0, indirect: 0 }, depLicenses: [], violations: [],
    verdict: 'SAFE', unverified: [], depsDevUrl: 'https://deps.dev/npm/lodash/4.17.21',
    osvQueryUrl: 'https://osv.dev/list?q=lodash', scorecardSourceUrl: null,
    ...partial,
  };
}

const fixedOptions = {
  now: () => new Date('2026-09-02T08:00:00.000Z'),
  idFactory: () => 'decision-1',
};

const ecosystemCases = [
  {
    label: 'NPM', system: 'NPM', name: 'lodash', current: '4.17.20', fixed: '4.17.22',
    command: 'npm install lodash@4.17.20', remediationCommand: 'npm install lodash@4.17.22',
  },
  {
    label: 'PyPI', system: 'PYPI', name: 'requests', current: '2.31.0', fixed: '2.32.3',
    command: 'pip install requests==2.31.0', remediationCommand: 'pip install requests==2.32.3',
  },
  {
    label: 'Cargo', system: 'CARGO', name: 'serde', current: '1.0.200', fixed: '1.0.204',
    command: 'cargo add serde@1.0.200', remediationCommand: 'cargo add serde@1.0.204',
  },
  {
    label: 'Go', system: 'GO', name: 'github.com/gin-gonic/gin', current: 'v1.9.0', fixed: 'v1.10.0',
    command: 'go get github.com/gin-gonic/gin@v1.9.0',
    remediationCommand: 'go get github.com/gin-gonic/gin@v1.10.0',
  },
  {
    label: 'RubyGems', system: 'RUBYGEMS', name: 'rails', current: '7.1.2', fixed: '7.1.3',
    command: 'gem install rails -v 7.1.2', remediationCommand: 'gem install rails -v 7.1.3',
  },
  {
    label: 'NuGet', system: 'NUGET', name: 'Newtonsoft.Json', current: '13.0.2', fixed: '13.0.3',
    command: 'dotnet add package Newtonsoft.Json --version 13.0.2',
    remediationCommand: 'dotnet add package Newtonsoft.Json --version 13.0.3',
  },
  {
    label: 'Maven', system: 'MAVEN', name: 'org.springframework.boot:spring-boot',
    current: '3.5.7', fixed: '3.5.8',
    command: 'mvn dependency:get -Dartifact=org.springframework.boot:spring-boot:3.5.7',
    remediationCommand: 'mvn dependency:get -Dartifact=org.springframework.boot:spring-boot:3.5.8',
  },
] as const;

describe('assessAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns not_applicable for commands outside the package-install surface', async () => {
    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm test', cwd: '/repo' },
      { policy, exceptions: [], ...fixedOptions },
    );

    expect(assessment).toEqual({
      schemaVersion: 1,
      applicability: 'not_applicable',
      subject: { kind: 'shell_command', command: 'npm test', cwd: '/repo' },
      reason: 'No supported package-install action was detected.',
    });
    expect(checkPackages).not.toHaveBeenCalled();
  });

  it('returns a versioned SAFE decision and an executable next action', async () => {
    checkPackages.mockResolvedValue([result()]);

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm install lodash@4.17.21', cwd: '/repo' },
      { policy, exceptions: [], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.decision).toMatchObject({
      schemaVersion: 1,
      id: 'decision-1',
      subject: { kind: 'shell_command', command: 'npm install lodash@4.17.21', cwd: '/repo' },
      packages: [{ system: 'NPM', name: 'lodash', requestedVersion: '4.17.21', resolvedVersion: '4.17.21' }],
      rawVerdict: 'SAFE',
      effectiveVerdict: 'SAFE',
      findings: [],
      errors: [],
      decidedAt: '2026-09-02T08:00:00.000Z',
    });
    expect(assessment.decision.policy.digest).toMatch(/^sha256:/);
    expect(assessment.nextAction).toMatchObject({
      kind: 'EXECUTE_ALLOWED_ACTION',
      command: 'npm install lodash@4.17.21',
    });
  });

  it.each(ecosystemCases)(
    'preserves the explicit $label version in the canonical package coordinate',
    async ({ system, name, current, command }) => {
      checkPackages.mockResolvedValue([result({ system, name, version: current })]);

      const assessment = await assessAction(
        { kind: 'shell_command', command, cwd: '/repo' },
        { policy, exceptions: [], ...fixedOptions },
      );

      expect(checkPackages).toHaveBeenCalledWith([{ system, name, version: current }], policy);
      expect(assessment.applicability).toBe('applicable');
      if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
      expect(assessment.decision.packages).toEqual([{
        system, name, requestedVersion: current, resolvedVersion: current,
      }]);
      expect(assessment.nextAction).toMatchObject({
        kind: 'EXECUTE_ALLOWED_ACTION', command,
      });
    }
  );

  it.each(ecosystemCases)(
    'renders an ecosystem-correct verified remediation for $label',
    async ({ system, name, current, fixed, command, remediationCommand }) => {
      const violation: Violation = {
        type: 'VULNERABILITY', severity: 'HIGH', reason: 'Known Vulnerability',
        details: ['CVE-2026-0001'], riskExplanation: '', fixedVersions: [fixed],
      };
      checkPackages.mockResolvedValue([
        result({ system, name, version: current, verdict: 'BLOCKED', violations: [violation] }),
      ]);
      checkPackage.mockResolvedValue(result({ system, name, version: fixed }));

      const assessment = await assessAction(
        { kind: 'shell_command', command, cwd: '/repo' },
        { policy, exceptions: [], ...fixedOptions },
      );

      expect(checkPackage).toHaveBeenCalledWith(system, name, fixed, policy);
      expect(assessment.applicability).toBe('applicable');
      if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
      expect(assessment.decision.remediation[0]).toMatchObject({
        system, name, current, recommendedVersion: fixed, verified: true,
      });
      expect(assessment.nextAction).toMatchObject({
        kind: 'TRY_VERIFIED_REMEDIATION', command: remediationCommand,
      });
    }
  );

  it('only proposes a remediation command after the candidate passes re-audit', async () => {
    const violation: Violation = {
      type: 'VULNERABILITY', severity: 'HIGH', reason: 'Known Vulnerability',
      details: ['CVE-2026-0001'], riskExplanation: '', fixedVersions: ['4.17.22'],
    };
    checkPackages.mockResolvedValue([
      result({ version: '4.17.20', verdict: 'BLOCKED', violations: [violation] }),
    ]);
    checkPackage.mockResolvedValue(result({ version: '4.17.22' }));

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm install lodash@4.17.20', cwd: '/repo' },
      { policy, exceptions: [], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.decision.remediation[0]).toMatchObject({
      recommendedVersion: '4.17.22', verified: true,
    });
    expect(assessment.nextAction).toMatchObject({
      kind: 'TRY_VERIFIED_REMEDIATION',
      command: 'npm install lodash@4.17.22',
    });
  });

  it('keeps clean packages in a consolidated verified-remediation command', async () => {
    const violation: Violation = {
      type: 'VULNERABILITY', severity: 'HIGH', reason: 'Known Vulnerability',
      details: ['CVE-2026-0001'], riskExplanation: '', fixedVersions: ['1.1.0'],
    };
    checkPackages.mockResolvedValue([
      result({ name: 'unsafe', version: '1.0.0', verdict: 'BLOCKED', violations: [violation] }),
      result({ name: 'clean', version: '2.0.0' }),
    ]);
    checkPackage.mockResolvedValue(result({ name: 'unsafe', version: '1.1.0' }));

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'pnpm add unsafe@1.0.0 clean@2.0.0', cwd: '/repo' },
      { policy, exceptions: [], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.nextAction).toMatchObject({
      kind: 'TRY_VERIFIED_REMEDIATION',
      command: 'pnpm add unsafe@1.1.0 clean@2.0.0',
    });
  });

  it('does not expose an unverified remediation as executable', async () => {
    const violation: Violation = {
      type: 'VULNERABILITY', severity: 'HIGH', reason: 'Known Vulnerability',
      details: ['CVE-2026-0001'], riskExplanation: '', fixedVersions: ['4.17.22'],
    };
    checkPackages.mockResolvedValue([
      result({ version: '4.17.20', verdict: 'BLOCKED', violations: [violation] }),
    ]);
    checkPackage.mockResolvedValue(result({ version: '4.17.22', verdict: 'UNKNOWN', unverified: ['Vulnerabilities (OSV)'] }));

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm install lodash@4.17.20', cwd: '/repo' },
      { policy, exceptions: [], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.decision.remediation[0]).toMatchObject({
      action: 'find-alternative', recommendedVersion: null, verified: false,
    });
    expect(assessment.nextAction.kind).toBe('STOP');
    expect(assessment.nextAction.command).toBeUndefined();
  });

  it('keeps raw BLOCKED while a trusted exception makes the effective verdict SAFE', async () => {
    const violation: Violation = {
      type: 'LICENSE', severity: 'HIGH', reason: 'Blocked License',
      details: ['GPL-3.0-only'], riskExplanation: '',
    };
    checkPackages.mockResolvedValue([result({ verdict: 'BLOCKED', violations: [violation] })]);

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm install lodash@4.17.21', cwd: '/repo' },
      { policy, exceptions: [{ package: 'lodash', version: '4.17.21', reason: 'Approved migration' }], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.decision.rawVerdict).toBe('BLOCKED');
    expect(assessment.decision.effectiveVerdict).toBe('SAFE');
    expect(assessment.decision.overrides).toHaveLength(1);
    expect(assessment.nextAction.kind).toBe('EXECUTE_ALLOWED_ACTION');
  });

  it('represents UNKNOWN as a retryable structured source error', async () => {
    checkPackages.mockResolvedValue([
      result({ verdict: 'UNKNOWN', unverified: ['Vulnerabilities (OSV)'] }),
    ]);

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm install lodash', cwd: '/repo' },
      { policy, exceptions: [], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.decision.errors).toContainEqual(expect.objectContaining({
      kind: 'EVIDENCE_UNAVAILABLE', source: 'osv', retryability: 'retryable',
      decisionImpact: 'UNKNOWN',
    }));
    expect(assessment.nextAction.kind).toBe('RETRY');
  });

  it('stops instead of retrying when the package authoritatively does not exist', async () => {
    checkPackages.mockResolvedValue([
      result({ verdict: 'UNKNOWN', unverified: ['Package not found on deps.dev (no metadata to audit)'] }),
    ]);

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm install package-that-is-not-real', cwd: '/repo' },
      { policy, exceptions: [], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.decision.errors[0]).toMatchObject({
      kind: 'SUBJECT_NOT_FOUND', retryability: 'non_retryable', decisionImpact: 'UNKNOWN',
    });
    expect(assessment.nextAction.kind).toBe('STOP');
  });

  it('requests governed approval only when the policy configures that workflow', async () => {
    const violation: Violation = {
      type: 'LICENSE', severity: 'HIGH', reason: 'Blocked License',
      details: ['GPL-3.0-only'], riskExplanation: '',
    };
    checkPackages.mockResolvedValue([result({ verdict: 'BLOCKED', violations: [violation] })]);

    const assessment = await assessAction(
      { kind: 'shell_command', command: 'npm install lodash@4.17.21', cwd: '/repo' },
      { policy: { ...policy, exceptionFormUrl: 'https://example.com/request' }, exceptions: [], ...fixedOptions },
    );

    expect(assessment.applicability).toBe('applicable');
    if (assessment.applicability !== 'applicable') throw new Error('expected applicable');
    expect(assessment.nextAction.kind).toBe('REQUEST_HUMAN_APPROVAL');
  });
});
