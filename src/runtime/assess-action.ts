import { randomUUID } from 'node:crypto';
import { checkPackages } from '../checker.js';
import type { ActionPlan } from '../core/action.js';
import type { ActionAssessment, AdmissionDecision, AppliedOverride } from '../core/decision.js';
import type { EvidenceRef, EvidenceStatus } from '../core/evidence.js';
import type { HawkeyeError } from '../core/errors.js';
import type { Finding } from '../core/finding.js';
import type { ActionIntent, PackageCoordinate } from '../core/intent.js';
import { policyRef } from '../core/policy-ref.js';
import { detectAndParse } from '../parser.js';
import { loadPolicy } from '../policy.js';
import type { CheckResult, Policy, Verdict } from '../types.js';
import { loadExceptions, matchException, type Exception } from '../util/exceptions.js';
import { buildInstallCommand } from '../util/install-command.js';
import { remediatePackage } from '../util/remediation.js';
import { aggregateVerdict } from '../util/verdict.js';
import { verifyRemediations } from './verify-remediation.js';

export interface AssessActionOptions {
  policy?: Policy;
  exceptions?: Exception[];
  now?: () => Date;
  idFactory?: () => string;
}

/** Internal sidecar used only to preserve the legacy CommandAudit projection. */
export interface AssessedActionDetails {
  assessment: ActionAssessment;
  command: string;
  system?: string;
  results: CheckResult[];
}

function packageCoordinate(result: CheckResult, requestedVersion?: string): PackageCoordinate {
  return {
    system: result.system,
    name: result.name,
    ...(requestedVersion ? { requestedVersion } : {}),
    resolvedVersion: result.version,
  };
}

function findingsFor(results: CheckResult[], requested: string[]): Finding[] {
  return results.flatMap((result, resultIndex) => {
    const subject = packageCoordinate(result, requested[resultIndex]);
    return result.violations.map((violation, findingIndex) => ({
      id: `${result.system}:${result.name}@${result.version}:finding:${findingIndex}`,
      subject,
      category: violation.type,
      severity: violation.severity,
      effect: violation.severity === 'LOW' ? 'advisory' as const : 'blocking' as const,
      title: violation.reason,
      details: violation.details,
      explanation: violation.riskExplanation,
      ...(violation.affectedDep ? { affectedDependency: violation.affectedDep } : {}),
      ...(violation.path ? { dependencyPath: violation.path } : {}),
      ...(violation.fixedVersions ? { fixedVersions: violation.fixedVersions } : {}),
    }));
  });
}

function sourceError(message: string, id: string): HawkeyeError {
  if (message.startsWith('Package not found')) {
    return {
      id, kind: 'SUBJECT_NOT_FOUND', source: 'deps.dev', retryability: 'non_retryable',
      decisionImpact: 'UNKNOWN', message,
    };
  }
  if (message.startsWith('Vulnerabilities')) {
    return {
      id, kind: 'EVIDENCE_UNAVAILABLE', source: 'osv', retryability: 'retryable',
      decisionImpact: 'UNKNOWN', message,
    };
  }
  if (message.startsWith('OpenSSF Scorecard')) {
    return {
      id, kind: 'EVIDENCE_UNAVAILABLE', source: 'scorecard', retryability: 'retryable',
      decisionImpact: 'ADVISORY_ONLY', message,
    };
  }
  if (message.includes('deps.dev')) {
    return {
      id, kind: 'EVIDENCE_UNAVAILABLE', source: 'deps.dev', retryability: 'retryable',
      decisionImpact: 'UNKNOWN', message,
    };
  }
  return {
    id, kind: 'EVIDENCE_UNAVAILABLE', source: 'hawkeye', retryability: 'unknown',
    decisionImpact: 'UNKNOWN', message,
  };
}

function errorsFor(results: CheckResult[]): HawkeyeError[] {
  return results.flatMap(result => result.unverified.map((message, index) =>
    sourceError(message, `${result.system}:${result.name}@${result.version}:error:${index}`)
  ));
}

function evidenceStatus(result: CheckResult, source: 'metadata' | 'dependencies' | 'osv' | 'scorecard'): EvidenceStatus {
  if (source === 'metadata' && result.unverified.some(item => item.startsWith('Package not found'))) return 'not_found';
  if (source === 'metadata' && result.unverified.some(item => item.startsWith('Package metadata'))) return 'unavailable';
  if (source === 'dependencies' && result.unverified.some(item => item.startsWith('Dependency graph'))) return 'unavailable';
  if (source === 'osv' && result.unverified.some(item => item.startsWith('Vulnerabilities'))) return 'unavailable';
  if (source === 'scorecard' && result.unverified.some(item => item.startsWith('OpenSSF Scorecard'))) return 'unavailable';
  return 'available';
}

function evidenceFor(results: CheckResult[], requested: string[]): EvidenceRef[] {
  return results.flatMap((result, index) => {
    const subject = packageCoordinate(result, requested[index]);
    const key = `${result.system}:${result.name}@${result.version}`;
    const refs: EvidenceRef[] = [
      {
        id: `${key}:metadata`, subject, type: 'license', source: 'deps.dev',
        trust: 'authoritative', status: evidenceStatus(result, 'metadata'), uri: result.depsDevUrl,
      },
      {
        id: `${key}:dependencies`, subject, type: 'dependency', source: 'deps.dev',
        trust: 'authoritative', status: evidenceStatus(result, 'dependencies'), uri: result.depsDevUrl,
      },
      {
        id: `${key}:vulnerabilities`, subject, type: 'vulnerability', source: 'osv',
        trust: 'authoritative', status: evidenceStatus(result, 'osv'), uri: result.osvQueryUrl,
      },
      {
        id: `${key}:scorecard`, subject, type: 'scorecard', source: 'OpenSSF Scorecard',
        trust: 'authoritative', status: evidenceStatus(result, 'scorecard'),
        ...(result.scorecardSourceUrl ? { uri: result.scorecardSourceUrl } : {}),
      },
    ];
    if (result.violations.some(item => item.type === 'TYPOSQUAT')) {
      refs.push({
        id: `${key}:typosquat`, subject, type: 'typosquat', source: 'Hawkeye',
        trust: 'heuristic', status: 'available',
      });
    }
    return refs;
  });
}

function aggregateEffectiveVerdict(results: CheckResult[], overrides: AppliedOverride[]): Verdict {
  const overridden = new Set(overrides.map(item => `${item.name}@${item.version}`));
  const effective = results.map(result =>
    result.verdict !== 'SAFE' && overridden.has(`${result.name}@${result.version}`)
      ? 'SAFE' as Verdict
      : result.verdict
  );
  if (effective.includes('BLOCKED')) return 'BLOCKED';
  if (effective.includes('UNKNOWN')) return 'UNKNOWN';
  return 'SAFE';
}

function nextActionFor(decision: AdmissionDecision, results: CheckResult[], tool: string, exceptionFormUrl: string): ActionPlan {
  const id = `${decision.id}:next`;
  if (decision.effectiveVerdict === 'SAFE') {
    return {
      id, kind: 'EXECUTE_ALLOWED_ACTION', command: decision.subject.command,
      reason: decision.overrides.length > 0
        ? 'The action is allowed by a trusted documented exception.'
        : 'The action passed Hawkeye admission policy.',
      expectedResult: 'The package-manager action is independently rechecked by enforcement and then executed.',
    };
  }

  const verified = decision.remediation.filter(item =>
    item.action === 'upgrade' && item.verified === true && item.recommendedVersion
  );
  if (verified.length > 0) {
    const overridden = new Set(decision.overrides.map(item => `${item.name}@${item.version}`));
    const installable = results.flatMap(result => {
      const fix = verified.find(item => item.name === result.name && item.system === result.system);
      if (fix?.recommendedVersion) return [{ name: result.name, version: fix.recommendedVersion }];
      if (result.verdict === 'SAFE' || overridden.has(`${result.name}@${result.version}`)) {
        return [{ name: result.name, version: result.version }];
      }
      return [];
    });
    const first = verified[0];
    return {
      id, kind: 'TRY_VERIFIED_REMEDIATION',
      command: buildInstallCommand(results[0]?.system ?? '', installable, tool),
      package: {
        system: first.system, name: first.name, requestedVersion: first.current,
        resolvedVersion: first.recommendedVersion ?? undefined,
      },
      reason: first.reason,
      expectedResult: 'The verified package set is submitted to normal Hawkeye enforcement before installation.',
    };
  }

  if (decision.effectiveVerdict === 'UNKNOWN') {
    const retryable = decision.errors.some(error =>
      error.decisionImpact === 'UNKNOWN' && error.retryability === 'retryable'
    );
    if (retryable) {
      return {
        id, kind: 'RETRY', retryAfterMs: 1000,
        reason: 'Required evidence is temporarily unavailable.',
        expectedResult: 'Hawkeye reassesses the original action after the retry delay.',
      };
    }
  }

  if (decision.effectiveVerdict === 'BLOCKED' && exceptionFormUrl) {
    return {
      id, kind: 'REQUEST_HUMAN_APPROVAL',
      reason: 'No verified remediation is available; a trusted human exception is required.',
      expectedResult: 'A governed approval source records a documented exception.',
    };
  }

  return {
    id, kind: 'STOP',
    reason: decision.effectiveVerdict === 'UNKNOWN'
      ? 'The action cannot be verified and has no safe automatic recovery.'
      : 'The action is blocked and has no verified remediation.',
    expectedResult: 'No dependency side effect occurs.',
  };
}

/**
 * Canonical one-shot admission API. This intentionally orchestrates existing
 * package checks in PR1; evidence collection is extracted in PR2.
 */
export async function assessActionDetailed(
  intent: ActionIntent,
  options: AssessActionOptions = {}
): Promise<AssessedActionDetails> {
  const command = intent.command.trim();
  const parsed = command ? detectAndParse(command.split(/\s+/)) : null;
  if (!parsed || parsed.result.packages.length === 0) {
    return {
      assessment: {
        schemaVersion: 1,
        applicability: 'not_applicable',
        subject: intent,
        reason: 'No supported package-install action was detected.',
      },
      command,
      results: [],
    };
  }

  const policy = options.policy ?? loadPolicy(intent.cwd);
  const exceptions = options.exceptions ?? loadExceptions(intent.cwd);
  const { system, packages } = parsed.result;
  const results = await checkPackages(
    packages.map(item => ({ system, name: item.name, version: item.version })),
    policy
  );

  const overrides: AppliedOverride[] = [];
  for (const result of results) {
    if (result.verdict === 'SAFE') continue;
    const exception = matchException(exceptions, result.system, result.name, result.version);
    if (!exception) continue;
    overrides.push({
      name: result.name,
      version: result.version,
      originalVerdict: result.verdict,
      reason: exception.reason,
      approvedBy: exception.approvedBy,
    });
  }

  const overridden = new Set(overrides.map(item => `${item.name}@${item.version}`));
  const candidates = results
    .filter(result => result.verdict !== 'SAFE' && !overridden.has(`${result.name}@${result.version}`))
    .map(remediatePackage);
  const remediation = await verifyRemediations(candidates, policy);
  const requestedVersions = packages.map(item => item.version);
  const decision: AdmissionDecision = {
    schemaVersion: 1,
    id: (options.idFactory ?? randomUUID)(),
    subject: { ...intent, command },
    packages: results.map((result, index) => packageCoordinate(result, requestedVersions[index])),
    rawVerdict: aggregateVerdict(results),
    effectiveVerdict: aggregateEffectiveVerdict(results, overrides),
    findings: findingsFor(results, requestedVersions),
    evidence: evidenceFor(results, requestedVersions),
    errors: errorsFor(results),
    overrides,
    remediation,
    policy: policyRef(policy),
    decidedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  const tool = command.split(/\s+/)[0] ?? '';

  return {
    assessment: {
      schemaVersion: 1,
      applicability: 'applicable',
      decision,
      nextAction: nextActionFor(decision, results, tool, policy.exceptionFormUrl),
    },
    command,
    system,
    results,
  };
}

export async function assessAction(
  intent: ActionIntent,
  options: AssessActionOptions = {}
): Promise<ActionAssessment> {
  return (await assessActionDetailed(intent, options)).assessment;
}
