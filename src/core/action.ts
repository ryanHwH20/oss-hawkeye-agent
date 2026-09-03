import type { PackageCoordinate } from './intent.js';

export type ActionKind =
  | 'ASSESS'
  | 'EXECUTE_ALLOWED_ACTION'
  | 'TRY_VERIFIED_REMEDIATION'
  | 'RETRY'
  | 'REQUEST_HUMAN_APPROVAL'
  | 'EXPLAIN'
  | 'STOP';

/** The one-shot next action. Stateful semantics arrive in Harness V1. */
export interface ActionPlan {
  id: string;
  kind: ActionKind;
  reason?: string;
  command?: string;
  package?: PackageCoordinate;
  retryAfterMs?: number;
  expectedResult: string;
}
