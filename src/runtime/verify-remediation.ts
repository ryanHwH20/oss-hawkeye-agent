import { checkPackage } from '../checker.js';
import type { RemediationCandidate } from '../core/remediation.js';
import type { CheckResult, Policy } from '../types.js';

function blockSummary(result: CheckResult): string {
  const violation = result.violations.find(item => item.severity !== 'LOW') ?? result.violations[0];
  if (violation) return `${violation.reason}${violation.affectedDep ? ` in ${violation.affectedDep}` : ''}`;
  return result.unverified.join('; ') || 'did not pass audit';
}

/** Re-audit every versioned fix before it becomes executable agent guidance. */
export async function verifyRemediations(
  remediation: RemediationCandidate[],
  policy: Policy
): Promise<RemediationCandidate[]> {
  return Promise.all(remediation.map(async candidate => {
    if (candidate.action !== 'upgrade' || !candidate.recommendedVersion) return candidate;
    const check = await checkPackage(candidate.system, candidate.name, candidate.recommendedVersion, policy);
    if (check.verdict === 'SAFE') {
      return { ...candidate, verified: true, reason: `${candidate.reason} (verified clean)` };
    }
    return {
      ...candidate,
      action: 'find-alternative' as const,
      recommendedVersion: null,
      fix: null,
      verified: false,
      reason:
        `${candidate.name}@${candidate.current} is vulnerable, but the patched ${candidate.recommendedVersion} ` +
        `still does not pass audit (${blockSummary(check)}). No fully clean version was found — ` +
        `choose an alternative package or request a documented exception.`,
    };
  }));
}
