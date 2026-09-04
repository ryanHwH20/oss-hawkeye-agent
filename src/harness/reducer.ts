import type { ActionKind, ActionPlan } from '../core/action.js';
import type { ActionAssessment } from '../core/decision.js';
import { HarnessError } from './errors.js';
import { nextAction } from './planner.js';
import type { ActionResult } from './result.js';
import type { HawkeyeRunPhase, HawkeyeRunState } from './state.js';
import { validateAssessment, validateResult, validateState } from './validation.js';

const expectedResults: Record<ActionKind, ActionResult['kind'] | undefined> = {
  ASSESS: 'ASSESSMENT_COMPLETED',
  EXECUTE_ALLOWED_ACTION: 'EXECUTION_COMPLETED',
  TRY_VERIFIED_REMEDIATION: 'EXECUTION_COMPLETED',
  RETRY: 'RETRY_COMPLETED',
  REQUEST_HUMAN_APPROVAL: 'APPROVAL_REQUESTED',
  STOP: 'STOPPED',
  EXPLAIN: undefined,
};

function phaseFor(plan: ActionPlan): HawkeyeRunPhase {
  switch (plan.kind) {
    case 'EXECUTE_ALLOWED_ACTION': return 'ready_to_execute';
    case 'TRY_VERIFIED_REMEDIATION': return 'blocked';
    case 'RETRY': return 'unknown';
    case 'REQUEST_HUMAN_APPROVAL': return 'awaiting_approval';
    case 'STOP': return 'blocked';
    default:
      throw new HarnessError('ASSESSMENT_MISMATCH', `Assessment cannot transition to ${plan.kind}.`);
  }
}

function applyAssessment(state: HawkeyeRunState, assessment: ActionAssessment): HawkeyeRunState {
  validateAssessment(assessment, state);
  if (assessment.applicability === 'not_applicable') {
    return {
      ...state,
      phase: 'completed',
      attempt: state.attempt + 1,
      remediationCandidates: [],
      pendingAction: undefined,
      terminalReason: assessment.reason,
      error: undefined,
    };
  }
  if (state.decisions.some(item => item.id === assessment.decision.id)) {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'Assessment decision was already submitted to this run.');
  }
  return {
    ...state,
    decisions: [...state.decisions, structuredClone(assessment.decision)],
    remediationCandidates: structuredClone(assessment.decision.remediation),
    phase: phaseFor(assessment.nextAction),
    attempt: state.attempt + 1,
    pendingAction: structuredClone(assessment.nextAction),
    terminalReason: undefined,
    error: undefined,
  };
}

/** Validates and immutably applies a result for the exact expected action. */
export function submitResult(
  state: HawkeyeRunState,
  actionId: string,
  result: unknown,
): HawkeyeRunState {
  validateState(state);
  if (state.phase === 'completed' || state.phase === 'failed') {
    throw new HarnessError('TERMINAL_STATE', `Run ${state.runId} is already ${state.phase}.`);
  }

  const expected = nextAction(state);
  if (!expected) throw new HarnessError('NO_PENDING_ACTION', 'The run has no pending action.');
  if (actionId !== expected.id) {
    throw new HarnessError('ACTION_MISMATCH', 'Result does not match the expected action.', {
      expectedActionId: expected.id,
      receivedActionId: actionId,
    });
  }

  validateResult(result);
  if (Date.parse(result.completedAt) < Date.parse(state.updatedAt)) {
    throw new HarnessError('INVALID_RESULT', 'Action result predates the current run state.');
  }
  const expectedKind = expectedResults[expected.kind];
  if (result.kind !== expectedKind) {
    throw new HarnessError('RESULT_KIND_MISMATCH', `${expected.kind} requires ${expectedKind}.`, {
      actionKind: expected.kind,
      resultKind: result.kind,
    });
  }

  let next = structuredClone(state);
  if (result.kind === 'ASSESSMENT_COMPLETED') {
    next = applyAssessment(next, result.assessment);
  } else if (result.kind === 'EXECUTION_COMPLETED') {
    if (result.command !== expected.command) {
      throw new HarnessError('INVALID_RESULT', 'Execution command does not match the pending action.');
    }
    next.pendingAction = undefined;
    next.phase = result.status === 'succeeded' ? 'completed' : 'failed';
    next.terminalReason = result.status === 'succeeded'
      ? 'The expected action reported successful execution.'
      : result.error ?? `The expected action exited with code ${result.exitCode}.`;
    next.error = result.status === 'failed'
      ? { message: next.terminalReason, actionId }
      : undefined;
  } else if (result.kind === 'RETRY_COMPLETED') {
    next.pendingAction = undefined;
    next.phase = 'pending_assessment';
  } else if (result.kind === 'APPROVAL_REQUESTED') {
    next.pendingAction = undefined;
    next.phase = 'awaiting_approval';
    next.approvals.push({
      actionId,
      status: 'requested',
      requestedAt: result.completedAt,
      ...(result.externalReference ? { externalReference: result.externalReference } : {}),
    });
  } else if (result.kind === 'STOPPED') {
    next.pendingAction = undefined;
    next.phase = 'failed';
    next.terminalReason = result.reason ?? expected.reason ?? 'The workflow stopped safely.';
  }

  next.updatedAt = result.completedAt;
  next.actionHistory.push({ action: structuredClone(expected), result: structuredClone(result) });
  return next;
}
