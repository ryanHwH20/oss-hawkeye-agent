import type {
  ActionAssessment,
  ActionIntent,
  ActionPlan,
  AssessActionOptions,
  HawkeyeRunState,
  LoadedPolicy,
  Policy,
  PolicyRef,
  ScanReport,
} from '../../../src/index.js';

export type HawkeyeChatCommand = 'check' | 'scan' | 'explain' | 'fix' | 'policy' | 'status';
export type HawkeyeChatOperation = HawkeyeChatCommand | 'help';

export interface HawkeyeChatRequest {
  command?: string;
  prompt: string;
  cwd: string;
  isCancellationRequested?: () => boolean;
}

export interface HawkeyeChatResponse {
  operation: HawkeyeChatOperation;
  status: 'ok' | 'blocked' | 'unknown' | 'error' | 'help' | 'cancelled';
  markdown: string;
  state?: HawkeyeRunState;
}

export interface HawkeyeStateStore {
  load(): Promise<unknown>;
  save(state: HawkeyeRunState): Promise<void>;
}

export interface HawkeyeChatDependencies {
  loadPolicyWithMetadata(cwd: string): LoadedPolicy;
  assessAction(intent: ActionIntent, options?: AssessActionOptions): Promise<ActionAssessment>;
  scanProject(cwd: string, policy: Policy): Promise<ScanReport>;
  createRun(
    intent: ActionIntent,
    policy: PolicyRef,
    options?: { runId?: string; now?: () => Date; maxAttempts?: number },
  ): HawkeyeRunState;
  nextAction(state: HawkeyeRunState): ActionPlan | null;
  submitResult(state: HawkeyeRunState, actionId: string, result: unknown): HawkeyeRunState;
  now(): Date;
  runId(): string;
}
