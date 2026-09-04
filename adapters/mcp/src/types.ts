import type {
  ActionAssessment,
  ActionPlan,
  ActionResult,
  AssessActionOptions,
  CreateRunOptions,
  HawkeyeRunState,
  LoadedPolicy,
} from '../../../src/index.js';
import type { ActionIntent, PolicyRef } from '../../../src/index.js';

export interface HawkeyeMcpDependencies {
  loadPolicyWithMetadata(cwd: string): LoadedPolicy;
  createRun(intent: ActionIntent, policy: PolicyRef, options?: CreateRunOptions): HawkeyeRunState;
  nextAction(state: HawkeyeRunState): ActionPlan | null;
  assessAction(intent: ActionIntent, options?: AssessActionOptions): Promise<ActionAssessment>;
  submitResult(state: HawkeyeRunState, actionId: string, result: unknown): HawkeyeRunState;
  now(): Date;
  runId(): string;
}

export interface HawkeyeMcpOutput {
  schemaVersion: 1;
  status: 'SAFE' | 'BLOCKED' | 'UNKNOWN' | 'NOT_APPLICABLE' | 'WORKFLOW';
  summary: string;
  state: HawkeyeRunState;
  nextAction: ActionPlan | null;
  assessment?: ActionAssessment;
}

export interface SubmitResultInput {
  state: HawkeyeRunState;
  actionId: string;
  result: ActionResult;
}
