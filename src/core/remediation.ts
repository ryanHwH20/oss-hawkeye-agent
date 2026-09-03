export type RemediationAction = 'upgrade' | 'find-alternative' | 'verify';

/** A machine-actionable recovery candidate for one package. */
export interface RemediationCandidate {
  name: string;
  system: string;
  current: string;
  action: RemediationAction;
  recommendedVersion: string | null;
  fix: string | null;
  verified?: boolean;
  reason: string;
}
