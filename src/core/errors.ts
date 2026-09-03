export type HawkeyeErrorKind =
  | 'EVIDENCE_UNAVAILABLE'
  | 'SUBJECT_NOT_FOUND'
  | 'UNSUPPORTED_CAPABILITY'
  | 'INTERNAL_ERROR';

export type Retryability = 'retryable' | 'non_retryable' | 'unknown';

/** Structured operational uncertainty; never a substitute for a finding. */
export interface HawkeyeError {
  id: string;
  kind: HawkeyeErrorKind;
  source?: 'osv' | 'deps.dev' | 'scorecard' | 'hawkeye';
  retryability: Retryability;
  decisionImpact: 'UNKNOWN' | 'ADVISORY_ONLY';
  message: string;
}
