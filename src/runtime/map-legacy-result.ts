import type { ActionAssessment } from '../core/decision.js';
import type { CheckResult, Verdict } from '../types.js';
import type { AssessedActionDetails } from './assess-action.js';

export interface LegacyCommandAuditProjection {
  detected: boolean;
  command: string;
  system?: string;
  results: CheckResult[];
  verdict: Verdict;
  effectiveVerdict: Verdict;
  overrides: import('../core/decision.js').AppliedOverride[];
  remediation: import('../core/remediation.js').RemediationCandidate[];
}

/** Keep the published check-command JSON stable while its source becomes canonical. */
export function mapLegacyCommandAudit(details: AssessedActionDetails): LegacyCommandAuditProjection {
  const assessment: ActionAssessment = details.assessment;
  if (assessment.applicability === 'not_applicable') {
    return {
      detected: false,
      command: details.command,
      results: [],
      verdict: 'SAFE',
      effectiveVerdict: 'SAFE',
      overrides: [],
      remediation: [],
    };
  }
  return {
    detected: true,
    command: details.command,
    system: details.system,
    results: details.results,
    verdict: assessment.decision.rawVerdict,
    effectiveVerdict: assessment.decision.effectiveVerdict,
    overrides: assessment.decision.overrides,
    remediation: assessment.decision.remediation,
  };
}
