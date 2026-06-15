import type { OsvVuln, BlockingSeverity } from '../types.js';

/** Orders severities so thresholds can be compared numerically. */
const RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNKNOWN: 0,
};

export function severityRank(severity: string): number {
  return RANK[severity] ?? 0;
}

/**
 * Whether a vulnerability's severity is at or above the policy's blocking
 * threshold. e.g. with threshold HIGH, a HIGH or CRITICAL vuln blocks but a
 * MEDIUM does not. UNKNOWN-severity vulns never block (rank 0).
 */
export function meetsBlockingThreshold(
  vulnSeverity: OsvVuln['severity'],
  threshold: BlockingSeverity
): boolean {
  return severityRank(vulnSeverity) >= severityRank(threshold);
}
