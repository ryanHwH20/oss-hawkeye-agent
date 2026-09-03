import type { ActionAssessment } from '../core/decision.js';

export interface AssessmentCompletedResult {
  schemaVersion: 1;
  kind: 'ASSESSMENT_COMPLETED';
  assessment: ActionAssessment;
  completedAt: string;
}

export interface ExecutionCompletedResult {
  schemaVersion: 1;
  kind: 'EXECUTION_COMPLETED';
  command: string;
  status: 'succeeded' | 'failed';
  exitCode: number;
  completedAt: string;
  error?: string;
}

export interface RetryCompletedResult {
  schemaVersion: 1;
  kind: 'RETRY_COMPLETED';
  completedAt: string;
}

/** A request receipt is not an authorization decision. */
export interface ApprovalRequestedResult {
  schemaVersion: 1;
  kind: 'APPROVAL_REQUESTED';
  completedAt: string;
  externalReference?: string;
}

export interface StoppedResult {
  schemaVersion: 1;
  kind: 'STOPPED';
  completedAt: string;
  reason?: string;
}

export type ActionResult =
  | AssessmentCompletedResult
  | ExecutionCompletedResult
  | RetryCompletedResult
  | ApprovalRequestedResult
  | StoppedResult;
