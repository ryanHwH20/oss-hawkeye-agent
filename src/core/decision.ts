import type { Verdict } from '../types.js';
import type { ActionPlan } from './action.js';
import type { EvidenceRef } from './evidence.js';
import type { HawkeyeError } from './errors.js';
import type { Finding } from './finding.js';
import type { ActionIntent, PackageCoordinate } from './intent.js';
import type { PolicyRef } from './policy-ref.js';
import type { RemediationCandidate } from './remediation.js';

/** A non-passing package allowed by a trusted, documented exception. */
export interface AppliedOverride {
  name: string;
  version: string;
  originalVerdict: Verdict;
  reason: string;
  approvedBy?: string;
}

/** Canonical security decision consumed by every future agent adapter. */
export interface AdmissionDecision {
  schemaVersion: 1;
  id: string;
  subject: ActionIntent;
  packages: PackageCoordinate[];
  rawVerdict: Verdict;
  effectiveVerdict: Verdict;
  findings: Finding[];
  evidence: EvidenceRef[];
  errors: HawkeyeError[];
  overrides: AppliedOverride[];
  remediation: RemediationCandidate[];
  policy: PolicyRef;
  decidedAt: string;
}

export interface ApplicableActionAssessment {
  schemaVersion: 1;
  applicability: 'applicable';
  decision: AdmissionDecision;
  nextAction: ActionPlan;
}

export interface NotApplicableActionAssessment {
  schemaVersion: 1;
  applicability: 'not_applicable';
  subject: ActionIntent;
  reason: string;
}

export type ActionAssessment = ApplicableActionAssessment | NotApplicableActionAssessment;
