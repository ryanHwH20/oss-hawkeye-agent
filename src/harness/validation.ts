import { isDeepStrictEqual } from 'node:util';
import type { ActionPlan } from '../core/action.js';
import type { ActionAssessment, AdmissionDecision } from '../core/decision.js';
import type { ActionIntent } from '../core/intent.js';
import { HarnessError } from './errors.js';
import type { ActionResult } from './result.js';
import type { HawkeyeRunPhase, HawkeyeRunState } from './state.js';

const phases = new Set<HawkeyeRunPhase>([
  'pending_assessment', 'blocked', 'unknown', 'awaiting_approval',
  'ready_to_execute', 'completed', 'failed',
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function timestamp(value: unknown): value is string {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every(key => keys.has(key));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function coordinate(value: unknown): boolean {
  return record(value)
    && nonEmpty(value.system)
    && nonEmpty(value.name)
    && (value.requestedVersion === undefined || typeof value.requestedVersion === 'string')
    && (value.resolvedVersion === undefined || typeof value.resolvedVersion === 'string');
}

function finding(value: unknown): boolean {
  return record(value)
    && nonEmpty(value.id)
    && coordinate(value.subject)
    && nonEmpty(value.category)
    && nonEmpty(value.severity)
    && ['blocking', 'advisory'].includes(String(value.effect))
    && nonEmpty(value.title)
    && stringArray(value.details)
    && typeof value.explanation === 'string'
    && (value.affectedDependency === undefined || typeof value.affectedDependency === 'string')
    && (value.dependencyPath === undefined || stringArray(value.dependencyPath))
    && (value.fixedVersions === undefined || stringArray(value.fixedVersions));
}

function evidence(value: unknown): boolean {
  return record(value)
    && nonEmpty(value.id)
    && coordinate(value.subject)
    && nonEmpty(value.type)
    && nonEmpty(value.source)
    && ['authoritative', 'heuristic', 'asserted'].includes(String(value.trust))
    && ['available', 'unavailable', 'not_found', 'unsupported'].includes(String(value.status))
    && (value.uri === undefined || typeof value.uri === 'string');
}

function operationalError(value: unknown): boolean {
  return record(value)
    && nonEmpty(value.id)
    && ['EVIDENCE_UNAVAILABLE', 'SUBJECT_NOT_FOUND', 'UNSUPPORTED_CAPABILITY', 'INTERNAL_ERROR']
      .includes(String(value.kind))
    && (value.source === undefined || ['osv', 'deps.dev', 'scorecard', 'hawkeye'].includes(String(value.source)))
    && ['retryable', 'non_retryable', 'unknown'].includes(String(value.retryability))
    && ['UNKNOWN', 'ADVISORY_ONLY'].includes(String(value.decisionImpact))
    && nonEmpty(value.message);
}

function override(value: unknown): boolean {
  return record(value)
    && nonEmpty(value.name)
    && nonEmpty(value.version)
    && ['SAFE', 'BLOCKED', 'UNKNOWN'].includes(String(value.originalVerdict))
    && nonEmpty(value.reason)
    && (value.approvedBy === undefined || typeof value.approvedBy === 'string');
}

function remediation(value: unknown): boolean {
  return record(value)
    && nonEmpty(value.name)
    && nonEmpty(value.system)
    && nonEmpty(value.current)
    && ['upgrade', 'find-alternative', 'verify'].includes(String(value.action))
    && (value.recommendedVersion === null || typeof value.recommendedVersion === 'string')
    && (value.fix === null || typeof value.fix === 'string')
    && (value.verified === undefined || typeof value.verified === 'boolean')
    && nonEmpty(value.reason);
}

export function sameIntent(left: ActionIntent, right: ActionIntent): boolean {
  return left.kind === right.kind
    && left.command === right.command
    && left.cwd === right.cwd;
}

export function validateState(state: unknown): asserts state is HawkeyeRunState {
  if (!record(state)
    || state.schemaVersion !== 1
    || !nonEmpty(state.runId)
    || !record(state.intent)
    || state.intent.kind !== 'shell_command'
    || typeof state.intent.command !== 'string'
    || !record(state.policy)
    || !nonEmpty(state.policy.digest)
    || !phases.has(state.phase as HawkeyeRunPhase)
    || !Number.isInteger(state.attempt)
    || (state.attempt as number) < 0
    || !Number.isInteger(state.maxAttempts)
    || (state.maxAttempts as number) < 1
    || !Array.isArray(state.decisions)
    || !Array.isArray(state.remediationCandidates)
    || !Array.isArray(state.actionHistory)
    || !Array.isArray(state.approvals)
    || !timestamp(state.createdAt)
    || !timestamp(state.updatedAt)) {
    throw new HarnessError('INVALID_STATE', 'HawkeyeRunState does not match schema version 1.');
  }
  if ((state.intent.cwd !== undefined && typeof state.intent.cwd !== 'string')
    || (state.policy.id !== undefined && typeof state.policy.id !== 'string')
    || state.decisions.length > (state.attempt as number)
    || !state.remediationCandidates.every(remediation)
    || state.actionHistory.some(item => !record(item) || !record(item.action) || !record(item.result))
    || state.approvals.some(item => !record(item)
      || !nonEmpty(item.actionId)
      || item.status !== 'requested'
      || !timestamp(item.requestedAt)
      || (item.externalReference !== undefined && typeof item.externalReference !== 'string'))) {
    throw new HarnessError('INVALID_STATE', 'HawkeyeRunState contains malformed workflow records.');
  }
  if (state.error !== undefined && (!record(state.error)
    || !nonEmpty(state.error.message)
    || (state.error.actionId !== undefined && typeof state.error.actionId !== 'string'))) {
    throw new HarnessError('INVALID_STATE', 'HawkeyeRunState contains a malformed workflow error.');
  }
  try {
    for (const item of state.decisions) {
      validateDecision(item);
      if (!sameIntent(item.subject, state.intent as unknown as ActionIntent)
        || item.policy.digest !== state.policy.digest) {
        throw new Error('decision identity mismatch');
      }
    }
    let assessmentCount = 0;
    const historicalDecisions: AdmissionDecision[] = [];
    state.actionHistory.forEach((item, index) => {
      const historicalAction: unknown = item.action;
      const historicalResult: unknown = item.result;
      validatePlan(historicalAction);
      validateResult(historicalResult);
      const expectedId = `${state.runId}:action:${index + 1}:${historicalAction.kind.toLowerCase()}`;
      if (historicalAction.id !== expectedId) throw new Error('action history ID mismatch');
      const resultKinds: Partial<Record<ActionPlan['kind'], ActionResult['kind']>> = {
        ASSESS: 'ASSESSMENT_COMPLETED',
        EXECUTE_ALLOWED_ACTION: 'EXECUTION_COMPLETED',
        TRY_VERIFIED_REMEDIATION: 'EXECUTION_COMPLETED',
        RETRY: 'RETRY_COMPLETED',
        REQUEST_HUMAN_APPROVAL: 'APPROVAL_REQUESTED',
        STOP: 'STOPPED',
      };
      if (resultKinds[historicalAction.kind] !== historicalResult.kind) throw new Error('action result kind mismatch');
      if (historicalResult.kind === 'ASSESSMENT_COMPLETED') {
        assessmentCount += 1;
        validateAssessment(historicalResult.assessment, state as unknown as HawkeyeRunState);
        if (historicalResult.assessment.applicability === 'applicable') {
          historicalDecisions.push(historicalResult.assessment.decision);
        }
      }
    });
    if (assessmentCount !== state.attempt) throw new Error('attempt count mismatch');
    if (!isDeepStrictEqual(historicalDecisions, state.decisions)) throw new Error('decision history mismatch');
    for (const approval of state.approvals) {
      const recorded = state.actionHistory.some(item =>
        item.action.id === approval.actionId
        && item.action.kind === 'REQUEST_HUMAN_APPROVAL'
        && item.result.kind === 'APPROVAL_REQUESTED'
        && item.result.completedAt === approval.requestedAt
      );
      if (!recorded) throw new Error('approval history mismatch');
    }
  } catch {
    throw new HarnessError('INVALID_STATE', 'HawkeyeRunState history or decisions failed integrity validation.');
  }
  if ((state.phase === 'completed' || state.phase === 'failed') && state.pendingAction !== undefined) {
    throw new HarnessError('INVALID_STATE', 'A terminal run cannot contain a pending action.');
  }
  if (state.pendingAction !== undefined) {
    try {
      validatePlan(state.pendingAction);
    } catch {
      throw new HarnessError('INVALID_STATE', 'HawkeyeRunState contains a malformed pending action.');
    }
    const legal: Partial<Record<HawkeyeRunPhase, ActionPlan['kind'][]>> = {
      ready_to_execute: ['EXECUTE_ALLOWED_ACTION'],
      blocked: ['TRY_VERIFIED_REMEDIATION', 'STOP'],
      unknown: ['RETRY', 'STOP'],
      awaiting_approval: ['REQUEST_HUMAN_APPROVAL'],
    };
    const phase = state.phase as HawkeyeRunPhase;
    if (!legal[phase]?.includes(state.pendingAction.kind)) {
      throw new HarnessError('INVALID_STATE', `${state.pendingAction.kind} is invalid during ${state.phase}.`);
    }
    const latest = state.decisions[state.decisions.length - 1];
    if (latest) {
      try {
        validateDecisionPlan(latest, state.pendingAction);
      } catch {
        throw new HarnessError('INVALID_STATE', 'Pending action does not match the latest decision.');
      }
      const latestAssessment = [...state.actionHistory].reverse().find(item =>
        item.result.kind === 'ASSESSMENT_COMPLETED'
        && item.result.assessment.applicability === 'applicable'
      );
      if (!latestAssessment
        || latestAssessment.result.kind !== 'ASSESSMENT_COMPLETED'
        || latestAssessment.result.assessment.applicability !== 'applicable'
        || !isDeepStrictEqual(latestAssessment.result.assessment.nextAction, state.pendingAction)) {
        throw new HarnessError('INVALID_STATE', 'Pending action differs from the submitted assessment.');
      }
    }
  } else if (!['pending_assessment', 'awaiting_approval', 'completed', 'failed'].includes(String(state.phase))) {
    throw new HarnessError('INVALID_STATE', `Phase ${state.phase} requires a pending action.`);
  }
}

export function validatePlan(plan: unknown): asserts plan is ActionPlan {
  if (!record(plan)
    || !nonEmpty(plan.id)
    || !nonEmpty(plan.kind)
    || !nonEmpty(plan.expectedResult)) {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'Assessment nextAction is malformed.');
  }
  const kinds = new Set([
    'ASSESS', 'EXECUTE_ALLOWED_ACTION', 'TRY_VERIFIED_REMEDIATION', 'RETRY',
    'REQUEST_HUMAN_APPROVAL', 'EXPLAIN', 'STOP',
  ]);
  if (!kinds.has(plan.kind)) {
    throw new HarnessError('ASSESSMENT_MISMATCH', `Unsupported action kind: ${plan.kind}`);
  }
  if ((plan.reason !== undefined && typeof plan.reason !== 'string')
    || (plan.command !== undefined && typeof plan.command !== 'string')
    || (plan.retryAfterMs !== undefined && (!Number.isFinite(plan.retryAfterMs) || (plan.retryAfterMs as number) < 0))
    || (plan.package !== undefined && (!record(plan.package)
      || !nonEmpty(plan.package.system)
      || !nonEmpty(plan.package.name)
      || (plan.package.requestedVersion !== undefined && typeof plan.package.requestedVersion !== 'string')
      || (plan.package.resolvedVersion !== undefined && typeof plan.package.resolvedVersion !== 'string')))) {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'Assessment nextAction has invalid fields.');
  }
  if (['EXECUTE_ALLOWED_ACTION', 'TRY_VERIFIED_REMEDIATION'].includes(String(plan.kind)) && !nonEmpty(plan.command)) {
    throw new HarnessError('ASSESSMENT_MISMATCH', `${plan.kind} requires a command.`);
  }
}

function validateDecision(decision: unknown): asserts decision is AdmissionDecision {
  if (!record(decision)
    || decision.schemaVersion !== 1
    || !nonEmpty(decision.id)
    || !record(decision.subject)
    || decision.subject.kind !== 'shell_command'
    || typeof decision.subject.command !== 'string'
    || (decision.subject.cwd !== undefined && typeof decision.subject.cwd !== 'string')
    || !record(decision.policy)
    || !nonEmpty(decision.policy.digest)
    || (decision.policy.id !== undefined && typeof decision.policy.id !== 'string')
    || !['SAFE', 'BLOCKED', 'UNKNOWN'].includes(String(decision.rawVerdict))
    || !['SAFE', 'BLOCKED', 'UNKNOWN'].includes(String(decision.effectiveVerdict))
    || !Array.isArray(decision.packages)
    || !Array.isArray(decision.findings)
    || !Array.isArray(decision.evidence)
    || !Array.isArray(decision.errors)
    || !Array.isArray(decision.overrides)
    || !Array.isArray(decision.remediation)
    || !timestamp(decision.decidedAt)
    || !decision.packages.every(coordinate)
    || !decision.findings.every(finding)
    || !decision.evidence.every(evidence)
    || !decision.errors.every(operationalError)
    || !decision.overrides.every(override)
    || !decision.remediation.every(remediation)) {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'AdmissionDecision is malformed.');
  }
}

function validateDecisionPlan(decision: AdmissionDecision, plan: ActionPlan): void {
  if (decision.effectiveVerdict === 'SAFE') {
    if (plan.kind !== 'EXECUTE_ALLOWED_ACTION' || plan.command !== decision.subject.command) {
      throw new HarnessError('ASSESSMENT_MISMATCH', 'A SAFE decision must execute the assessed command.');
    }
    return;
  }

  if (plan.kind === 'TRY_VERIFIED_REMEDIATION') {
    const candidate = plan.package && decision.remediation.find(item =>
      item.system === plan.package?.system
      && item.name === plan.package.name
      && item.verified === true
      && item.recommendedVersion === plan.package.resolvedVersion
      && item.current === plan.package.requestedVersion
    );
    if (!candidate || !nonEmpty(plan.command)) {
      throw new HarnessError('ASSESSMENT_MISMATCH', 'Remediation must reference a verified candidate and command.');
    }
    return;
  }

  if (plan.kind === 'RETRY') {
    const retryable = decision.effectiveVerdict === 'UNKNOWN'
      && decision.errors.some(error => error.decisionImpact === 'UNKNOWN' && error.retryability === 'retryable');
    if (!retryable) {
      throw new HarnessError('ASSESSMENT_MISMATCH', 'RETRY requires retryable UNKNOWN evidence.');
    }
    return;
  }

  if (plan.kind === 'REQUEST_HUMAN_APPROVAL' && decision.effectiveVerdict === 'BLOCKED') {
    if (decision.remediation.some(item => item.verified === true && item.recommendedVersion)) {
      throw new HarnessError('ASSESSMENT_MISMATCH', 'Approval cannot bypass a verified remediation plan.');
    }
    return;
  }
  if (plan.kind === 'STOP') return;

  throw new HarnessError('ASSESSMENT_MISMATCH', `${plan.kind} is inconsistent with the admission decision.`);
}

export function validateAssessment(
  assessment: unknown,
  state: HawkeyeRunState,
): asserts assessment is ActionAssessment {
  if (!record(assessment) || assessment.schemaVersion !== 1) {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'ActionAssessment is malformed.');
  }
  if (assessment.applicability === 'not_applicable') {
    if (!record(assessment.subject)
      || !sameIntent(assessment.subject as unknown as ActionIntent, state.intent)
      || !nonEmpty(assessment.reason)) {
      throw new HarnessError('ASSESSMENT_MISMATCH', 'Not-applicable assessment does not match the run intent.');
    }
    return;
  }
  if (assessment.applicability !== 'applicable') {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'Unknown assessment applicability.');
  }

  validateDecision(assessment.decision);
  validatePlan(assessment.nextAction);
  if (!sameIntent(assessment.decision.subject, state.intent)) {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'Assessment subject does not match the run intent.');
  }
  if (assessment.decision.policy.digest !== state.policy.digest) {
    throw new HarnessError('ASSESSMENT_MISMATCH', 'Assessment policy digest does not match the run policy.');
  }
  validateDecisionPlan(assessment.decision, assessment.nextAction);
}

export function validateResult(result: unknown): asserts result is ActionResult {
  if (!record(result) || result.schemaVersion !== 1 || !nonEmpty(result.kind) || !timestamp(result.completedAt)) {
    throw new HarnessError('INVALID_RESULT', 'ActionResult does not match schema version 1.');
  }
  switch (result.kind) {
    case 'ASSESSMENT_COMPLETED':
      if (!hasOnlyKeys(result, ['schemaVersion', 'kind', 'assessment', 'completedAt'])
        || !record(result.assessment)) {
        throw new HarnessError('INVALID_RESULT', 'Assessment result is malformed.');
      }
      return;
    case 'EXECUTION_COMPLETED':
      if (!hasOnlyKeys(result, ['schemaVersion', 'kind', 'command', 'status', 'exitCode', 'completedAt', 'error'])
        || !nonEmpty(result.command)
        || !['succeeded', 'failed'].includes(String(result.status))
        || !Number.isInteger(result.exitCode)
        || (result.status === 'succeeded' && result.exitCode !== 0)
        || (result.error !== undefined && typeof result.error !== 'string')) {
        throw new HarnessError('INVALID_RESULT', 'Execution result is malformed.');
      }
      return;
    case 'RETRY_COMPLETED':
      if (!hasOnlyKeys(result, ['schemaVersion', 'kind', 'completedAt'])) {
        throw new HarnessError('INVALID_RESULT', 'Retry result is malformed.');
      }
      return;
    case 'APPROVAL_REQUESTED':
      if (!hasOnlyKeys(result, ['schemaVersion', 'kind', 'completedAt', 'externalReference'])
        || (result.externalReference !== undefined && typeof result.externalReference !== 'string')) {
        throw new HarnessError('INVALID_RESULT', 'Approval request result is malformed.');
      }
      return;
    case 'STOPPED':
      if (!hasOnlyKeys(result, ['schemaVersion', 'kind', 'completedAt', 'reason'])
        || (result.reason !== undefined && typeof result.reason !== 'string')) {
        throw new HarnessError('INVALID_RESULT', 'Stop result is malformed.');
      }
      return;
    default:
      throw new HarnessError('INVALID_RESULT', `Unsupported result kind: ${result.kind}`);
  }
}
