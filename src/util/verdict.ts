import type { CheckResult, Verdict } from '../types.js';

/**
 * Aggregate many package verdicts into one. BLOCKED dominates; otherwise any
 * UNKNOWN makes the whole set UNKNOWN (fail-closed); only an all-clear set is
 * SAFE. Shared by `hawkeye scan` and the install guardrail.
 */
export function aggregateVerdict(results: CheckResult[]): Verdict {
  if (results.some(r => r.verdict === 'BLOCKED')) return 'BLOCKED';
  if (results.some(r => r.verdict === 'UNKNOWN')) return 'UNKNOWN';
  return 'SAFE';
}
