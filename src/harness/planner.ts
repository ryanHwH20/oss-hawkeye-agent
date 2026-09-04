import type { ActionKind, ActionPlan } from '../core/action.js';
import { HarnessError } from './errors.js';
import type { HawkeyeRunState } from './state.js';
import { validateState } from './validation.js';

function actionId(state: HawkeyeRunState, kind: ActionKind): string {
  return `${state.runId}:action:${state.actionHistory.length + 1}:${kind.toLowerCase()}`;
}

function reidentify(state: HawkeyeRunState, plan: ActionPlan): ActionPlan {
  return { ...structuredClone(plan), id: actionId(state, plan.kind) };
}

/** Returns the one legal next action. Identical state produces identical output. */
export function nextAction(state: HawkeyeRunState): ActionPlan | null {
  validateState(state);
  if (state.phase === 'completed' || state.phase === 'failed') return null;

  if (state.pendingAction) {
    if (state.pendingAction.kind === 'RETRY' && state.attempt >= state.maxAttempts) {
      return {
        id: actionId(state, 'STOP'),
        kind: 'STOP',
        reason: `The assessment retry budget of ${state.maxAttempts} attempts is exhausted.`,
        expectedResult: 'No dependency side effect occurs.',
      };
    }
    return reidentify(state, state.pendingAction);
  }

  if (state.phase === 'pending_assessment' || state.phase === 'awaiting_approval') {
    return {
      id: actionId(state, 'ASSESS'),
      kind: 'ASSESS',
      reason: state.phase === 'awaiting_approval'
        ? 'Reassess after the trusted approval source has been updated.'
        : 'Assess the proposed action before any dependency side effect.',
      expectedResult: 'A canonical Hawkeye ActionAssessment for the original intent and policy.',
    };
  }

  throw new HarnessError('NO_PENDING_ACTION', `Phase ${state.phase} has no pending action.`);
}
