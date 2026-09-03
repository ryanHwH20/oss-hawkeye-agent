import { randomUUID } from 'node:crypto';
import type { ActionIntent } from '../core/intent.js';
import type { PolicyRef } from '../core/policy-ref.js';
import { HarnessError } from './errors.js';
import type { HawkeyeRunState } from './state.js';

export interface CreateRunOptions {
  runId?: string;
  now?: () => Date;
  maxAttempts?: number;
}

/** Creates a workflow. Inject runId and now when reproducible fixtures matter. */
export function createRun(
  intent: ActionIntent,
  policy: PolicyRef,
  options: CreateRunOptions = {},
): HawkeyeRunState {
  const runId = options.runId ?? randomUUID();
  const maxAttempts = options.maxAttempts ?? 3;

  if (typeof runId !== 'string' || !runId.trim()) {
    throw new HarnessError('INVALID_STATE', 'runId must not be empty.');
  }
  if (!intent || intent.kind !== 'shell_command' || typeof intent.command !== 'string'
    || (intent.cwd !== undefined && typeof intent.cwd !== 'string')) {
    throw new HarnessError('INVALID_STATE', 'intent must be a valid shell-command intent.');
  }
  if (!policy || typeof policy.digest !== 'string' || !policy.digest.trim()
    || (policy.id !== undefined && typeof policy.id !== 'string')) {
    throw new HarnessError('INVALID_STATE', 'policy.digest must not be empty.');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new HarnessError('INVALID_STATE', 'maxAttempts must be a positive integer.');
  }
  const nowValue = (options.now ?? (() => new Date()))();
  if (!(nowValue instanceof Date) || Number.isNaN(nowValue.getTime())) {
    throw new HarnessError('INVALID_STATE', 'now must return a valid Date.');
  }
  const now = nowValue.toISOString();

  return {
    schemaVersion: 1,
    runId,
    intent: { ...intent, command: intent.command.trim() },
    policy: { ...policy },
    decisions: [],
    remediationCandidates: [],
    phase: 'pending_assessment',
    attempt: 0,
    maxAttempts,
    actionHistory: [],
    approvals: [],
    createdAt: now,
    updatedAt: now,
  };
}
