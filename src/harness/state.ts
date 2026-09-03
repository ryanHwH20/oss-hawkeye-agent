import type { ActionPlan } from '../core/action.js';
import type { AdmissionDecision } from '../core/decision.js';
import type { ActionIntent } from '../core/intent.js';
import type { PolicyRef } from '../core/policy-ref.js';
import type { RemediationCandidate } from '../core/remediation.js';
import type { ActionResult } from './result.js';

export type HawkeyeRunPhase =
  | 'pending_assessment'
  | 'blocked'
  | 'unknown'
  | 'awaiting_approval'
  | 'ready_to_execute'
  | 'completed'
  | 'failed';

export interface ActionRecord {
  action: ActionPlan;
  result: ActionResult;
}

/** Records that an approval was requested, never that an agent granted it. */
export interface ApprovalRecord {
  actionId: string;
  status: 'requested';
  requestedAt: string;
  externalReference?: string;
}

export interface RunError {
  message: string;
  actionId?: string;
}

/** Serializable state required to resume a Hawkeye-controlled agent workflow. */
export interface HawkeyeRunState {
  schemaVersion: 1;
  runId: string;
  intent: ActionIntent;
  policy: PolicyRef;
  decisions: AdmissionDecision[];
  remediationCandidates: RemediationCandidate[];
  phase: HawkeyeRunPhase;
  /** Number of completed assessments, including an UNKNOWN assessment. */
  attempt: number;
  maxAttempts: number;
  actionHistory: ActionRecord[];
  approvals: ApprovalRecord[];
  /** The exact plan returned by the most recent applicable assessment. */
  pendingAction?: ActionPlan;
  createdAt: string;
  updatedAt: string;
  terminalReason?: string;
  error?: RunError;
}
