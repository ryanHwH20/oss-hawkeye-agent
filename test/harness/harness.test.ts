import { describe, expect, it } from 'vitest';
import type { ActionPlan } from '../../src/core/action.js';
import type { ActionAssessment, AdmissionDecision } from '../../src/core/decision.js';
import type { ActionIntent, PackageCoordinate } from '../../src/core/intent.js';
import { createRun } from '../../src/harness/create-run.js';
import { HarnessError } from '../../src/harness/errors.js';
import { nextAction } from '../../src/harness/planner.js';
import { submitResult } from '../../src/harness/reducer.js';
import type { HawkeyeRunState } from '../../src/harness/state.js';

const time = '2026-09-03T08:00:00.000Z';
const nextTime = '2026-09-03T08:01:00.000Z';
const policy = { id: 'Test', digest: 'sha256:test-policy' };

const ecosystemCases = [
  {
    label: 'NPM', system: 'NPM', name: 'lodash', current: '4.17.20', fixed: '4.17.21',
    command: 'npm install lodash@4.17.20', remediation: 'npm install lodash@4.17.21',
  },
  {
    label: 'PyPI', system: 'PYPI', name: 'requests', current: '2.31.0', fixed: '2.32.3',
    command: 'pip install requests==2.31.0', remediation: 'pip install requests==2.32.3',
  },
  {
    label: 'Cargo', system: 'CARGO', name: 'serde', current: '1.0.200', fixed: '1.0.204',
    command: 'cargo add serde@1.0.200', remediation: 'cargo add serde@1.0.204',
  },
  {
    label: 'Go', system: 'GO', name: 'github.com/gin-gonic/gin', current: 'v1.9.0', fixed: 'v1.10.0',
    command: 'go get github.com/gin-gonic/gin@v1.9.0',
    remediation: 'go get github.com/gin-gonic/gin@v1.10.0',
  },
  {
    label: 'RubyGems', system: 'RUBYGEMS', name: 'rails', current: '7.1.2', fixed: '7.1.3',
    command: 'gem install rails -v 7.1.2', remediation: 'gem install rails -v 7.1.3',
  },
  {
    label: 'NuGet', system: 'NUGET', name: 'Newtonsoft.Json', current: '13.0.2', fixed: '13.0.3',
    command: 'dotnet add package Newtonsoft.Json --version 13.0.2',
    remediation: 'dotnet add package Newtonsoft.Json --version 13.0.3',
  },
  {
    label: 'Maven', system: 'MAVEN', name: 'org.springframework.boot:spring-boot',
    current: '3.5.7', fixed: '3.5.8',
    command: 'mvn dependency:get -Dartifact=org.springframework.boot:spring-boot:3.5.7',
    remediation: 'mvn dependency:get -Dartifact=org.springframework.boot:spring-boot:3.5.8',
  },
] as const;

function intent(command = 'npm install lodash@4.17.21'): ActionIntent {
  return { kind: 'shell_command', command, cwd: '/repo' };
}

function coordinate(
  system = 'NPM',
  name = 'lodash',
  requestedVersion = '4.17.21',
  resolvedVersion = requestedVersion,
): PackageCoordinate {
  return { system, name, requestedVersion, resolvedVersion };
}

function decision(
  subject: ActionIntent,
  partial: Partial<AdmissionDecision> = {},
): AdmissionDecision {
  return {
    schemaVersion: 1,
    id: 'decision-1',
    subject,
    packages: [coordinate()],
    rawVerdict: 'SAFE',
    effectiveVerdict: 'SAFE',
    findings: [],
    evidence: [],
    errors: [],
    overrides: [],
    remediation: [],
    policy,
    decidedAt: time,
    ...partial,
  };
}

function applicable(
  subject: ActionIntent,
  plan: ActionPlan,
  partial: Partial<AdmissionDecision> = {},
): ActionAssessment {
  return {
    schemaVersion: 1,
    applicability: 'applicable',
    decision: decision(subject, partial),
    nextAction: plan,
  };
}

function run(command = 'npm install lodash@4.17.21', maxAttempts = 3): HawkeyeRunState {
  return createRun(intent(command), policy, {
    runId: 'run-1', maxAttempts, now: () => new Date(time),
  });
}

function assess(state: HawkeyeRunState, assessment: ActionAssessment, completedAt = nextTime): HawkeyeRunState {
  const action = nextAction(state);
  if (!action) throw new Error('expected action');
  return submitResult(state, action.id, {
    schemaVersion: 1, kind: 'ASSESSMENT_COMPLETED', assessment, completedAt,
  });
}

describe('Agent Harness V1', () => {
  it('creates a versioned run and plans ASSESS deterministically', () => {
    const state = run();
    expect(state).toMatchObject({
      schemaVersion: 1, runId: 'run-1', phase: 'pending_assessment',
      attempt: 0, maxAttempts: 3, decisions: [], remediationCandidates: [],
      actionHistory: [], approvals: [],
    });
    expect(nextAction(state)).toEqual(nextAction(structuredClone(state)));
    expect(nextAction(state)).toMatchObject({
      id: 'run-1:action:1:assess', kind: 'ASSESS',
    });
  });

  it('round-trips through JSON and resumes with the same action', () => {
    const subject = intent();
    const state = assess(run(), applicable(subject, {
      id: 'one-shot-id', kind: 'EXECUTE_ALLOWED_ACTION', command: subject.command,
      expectedResult: 'execute',
    }));
    const restored = JSON.parse(JSON.stringify(state)) as HawkeyeRunState;

    expect(nextAction(restored)).toEqual(nextAction(state));
    expect(restored.decisions).toEqual(state.decisions);
  });

  it('does not mutate state or submitted assessment', () => {
    const original = run();
    const subject = intent();
    const assessment = applicable(subject, {
      id: 'one-shot-id', kind: 'EXECUTE_ALLOWED_ACTION', command: subject.command,
      expectedResult: 'execute',
    });
    const originalSnapshot = structuredClone(original);
    const assessmentSnapshot = structuredClone(assessment);

    const updated = assess(original, assessment);
    expect(original).toEqual(originalSnapshot);
    expect(assessment).toEqual(assessmentSnapshot);
    expect(updated).not.toBe(original);
    if (assessment.applicability === 'applicable') {
      assessment.decision.id = 'mutated-after-submit';
      expect(updated.decisions[0]?.id).toBe('decision-1');
    }
  });

  it('does not expose mutable state references through a planned action', () => {
    const subject = intent();
    const assessed = assess(run(), applicable(subject, {
      id: 'remediation', kind: 'TRY_VERIFIED_REMEDIATION',
      command: 'npm install lodash@4.17.22',
      package: coordinate('NPM', 'lodash', '4.17.21', '4.17.22'),
      expectedResult: 'execute',
    }, {
      rawVerdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{
        system: 'NPM', name: 'lodash', current: '4.17.21', action: 'upgrade',
        recommendedVersion: '4.17.22', fix: 'upgrade', verified: true, reason: 'fix',
      }],
    }));
    const action = nextAction(assessed);
    if (!action?.package) throw new Error('expected remediation package');
    action.package.name = 'mutated';

    expect(assessed.pendingAction?.package?.name).toBe('lodash');
  });

  it('rejects invalid run configuration with structured errors', () => {
    expect(() => createRun(intent(), policy, { runId: '', maxAttempts: 3 })).toThrowError(HarnessError);
    expect(() => createRun(intent(), policy, { runId: 'run', maxAttempts: 0 })).toThrowError(HarnessError);
    expect(() => createRun(intent(), policy, {
      runId: 'run', now: () => new Date('invalid'),
    })).toThrowError(HarnessError);
  });

  it('completes a not-applicable run without claiming SAFE', () => {
    const state = run('npm test');
    const updated = assess(state, {
      schemaVersion: 1,
      applicability: 'not_applicable',
      subject: intent('npm test'),
      reason: 'No supported package-install action was detected.',
    });

    expect(updated.phase).toBe('completed');
    expect(updated.decisions).toEqual([]);
    expect(nextAction(updated)).toBeNull();
  });

  it.each(ecosystemCases)('executes an exact SAFE $label plan', ({ system, name, current, command }) => {
    const subject = intent(command);
    const assessed = assess(run(command), applicable(subject, {
      id: 'one-shot-id', kind: 'EXECUTE_ALLOWED_ACTION', command, expectedResult: 'execute',
    }, { packages: [coordinate(system, name, current)] }));
    const action = nextAction(assessed);

    expect(action).toMatchObject({ kind: 'EXECUTE_ALLOWED_ACTION', command });
    expect(assessed.decisions[0]?.packages).toEqual([coordinate(system, name, current)]);
    if (!action) throw new Error('expected action');
    const completed = submitResult(assessed, action.id, {
      schemaVersion: 1, kind: 'EXECUTION_COMPLETED', command,
      status: 'succeeded', exitCode: 0, completedAt: nextTime,
    });
    expect(completed.phase).toBe('completed');
    expect(nextAction(completed)).toBeNull();
  });

  it.each(ecosystemCases)(
    'preserves an exact verified $label remediation plan',
    ({ system, name, current, fixed, command, remediation }) => {
      const subject = intent(command);
      const packageCoordinate = coordinate(system, name, current, fixed);
      const assessed = assess(run(command), applicable(subject, {
        id: 'one-shot-id', kind: 'TRY_VERIFIED_REMEDIATION', command: remediation,
        package: packageCoordinate, expectedResult: 'recheck then execute',
      }, {
        packages: [coordinate(system, name, current)],
        rawVerdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
        remediation: [{
          system, name, current, action: 'upgrade', recommendedVersion: fixed,
          fix: remediation, verified: true, reason: 'verified fix',
        }],
      }));

      expect(assessed.phase).toBe('blocked');
      expect(nextAction(assessed)).toMatchObject({
        kind: 'TRY_VERIFIED_REMEDIATION', command: remediation, package: packageCoordinate,
      });
    },
  );

  it('rejects an unverified remediation', () => {
    const subject = intent();
    const assessment = applicable(subject, {
      id: 'bad', kind: 'TRY_VERIFIED_REMEDIATION', command: 'npm install lodash@5.0.0',
      package: coordinate('NPM', 'lodash', '4.17.21', '5.0.0'), expectedResult: 'execute',
    }, {
      rawVerdict: 'BLOCKED', effectiveVerdict: 'BLOCKED',
      remediation: [{
        system: 'NPM', name: 'lodash', current: '4.17.21', action: 'upgrade',
        recommendedVersion: '5.0.0', fix: 'upgrade', verified: false, reason: 'not verified',
      }],
    });

    expect(() => assess(run(), assessment)).toThrowError(HarnessError);
    expect(() => assess(run(), assessment)).toThrow(/verified candidate/);
  });

  it('bounds retryable UNKNOWN assessments and stops after the budget', () => {
    const subject = intent();
    const retryAssessment = applicable(subject, {
      id: 'retry', kind: 'RETRY', retryAfterMs: 1000,
      expectedResult: 'reassess',
    }, {
      rawVerdict: 'UNKNOWN', effectiveVerdict: 'UNKNOWN',
      errors: [{
        id: 'error-1', kind: 'EVIDENCE_UNAVAILABLE', source: 'osv',
        retryability: 'retryable', decisionImpact: 'UNKNOWN', message: 'OSV unavailable',
      }],
    });

    let state = assess(run(subject.command, 2), retryAssessment);
    let action = nextAction(state);
    expect(action?.kind).toBe('RETRY');
    if (!action) throw new Error('expected retry');
    state = submitResult(state, action.id, {
      schemaVersion: 1, kind: 'RETRY_COMPLETED', completedAt: nextTime,
    });
    const secondAssessment = structuredClone(retryAssessment);
    if (secondAssessment.applicability === 'applicable') secondAssessment.decision.id = 'decision-2';
    state = assess(state, secondAssessment);

    action = nextAction(state);
    expect(action).toMatchObject({ kind: 'STOP' });
    expect(action?.reason).toContain('2 attempts');
  });

  it('records only an approval request and requires reassessment', () => {
    const subject = intent();
    let state = assess(run(), applicable(subject, {
      id: 'approval', kind: 'REQUEST_HUMAN_APPROVAL', expectedResult: 'request approval',
    }, { rawVerdict: 'BLOCKED', effectiveVerdict: 'BLOCKED' }));
    const action = nextAction(state);
    if (!action) throw new Error('expected approval action');

    state = submitResult(state, action.id, {
      schemaVersion: 1, kind: 'APPROVAL_REQUESTED', completedAt: nextTime,
      externalReference: 'ticket-123',
    });

    expect(state.phase).toBe('awaiting_approval');
    expect(state.decisions[0]?.effectiveVerdict).toBe('BLOCKED');
    expect(state.approvals).toEqual([{
      actionId: action.id, status: 'requested', requestedAt: nextTime,
      externalReference: 'ticket-123',
    }]);
    expect(nextAction(state)?.kind).toBe('ASSESS');
  });

  it('rejects agent-invented approval fields', () => {
    const subject = intent();
    const state = assess(run(), applicable(subject, {
      id: 'approval', kind: 'REQUEST_HUMAN_APPROVAL', expectedResult: 'request approval',
    }, { rawVerdict: 'BLOCKED', effectiveVerdict: 'BLOCKED' }));
    const action = nextAction(state);
    if (!action) throw new Error('expected approval action');

    expect(() => submitResult(state, action.id, {
      schemaVersion: 1, kind: 'APPROVAL_REQUESTED', completedAt: nextTime,
      approved: true,
    })).toThrow(/Approval request result is malformed/);
    expect(state.approvals).toEqual([]);
    expect(state.decisions[0]?.effectiveVerdict).toBe('BLOCKED');
  });

  it('rejects a non-retryable UNKNOWN plan that claims it can retry', () => {
    const subject = intent();
    const assessment = applicable(subject, {
      id: 'retry', kind: 'RETRY', expectedResult: 'retry',
    }, {
      rawVerdict: 'UNKNOWN', effectiveVerdict: 'UNKNOWN',
      errors: [{
        id: 'not-found', kind: 'SUBJECT_NOT_FOUND', source: 'deps.dev',
        retryability: 'non_retryable', decisionImpact: 'UNKNOWN', message: 'not found',
      }],
    });

    expect(() => assess(run(), assessment)).toThrow(/retryable UNKNOWN/);
  });

  it('submits STOP without a side effect for an unrecoverable decision', () => {
    const subject = intent();
    let state = assess(run(), applicable(subject, {
      id: 'stop', kind: 'STOP', reason: 'No safe recovery.', expectedResult: 'no side effect',
    }, { rawVerdict: 'BLOCKED', effectiveVerdict: 'BLOCKED' }));
    const action = nextAction(state);
    expect(action?.kind).toBe('STOP');
    if (!action) throw new Error('expected stop');

    state = submitResult(state, action.id, {
      schemaVersion: 1, kind: 'STOPPED', completedAt: nextTime,
    });
    expect(state.phase).toBe('failed');
    expect(state.terminalReason).toBe('No safe recovery.');
  });

  it('rejects stale, duplicate, wrong-kind, and wrong-command results', () => {
    const initial = run();
    const action = nextAction(initial);
    if (!action) throw new Error('expected assessment action');
    const assessment = applicable(intent(), {
      id: 'safe', kind: 'EXECUTE_ALLOWED_ACTION', command: intent().command,
      expectedResult: 'execute',
    });

    expect(() => submitResult(initial, 'stale-id', {
      schemaVersion: 1, kind: 'ASSESSMENT_COMPLETED', assessment, completedAt: nextTime,
    })).toThrow(/expected action/);
    expect(() => submitResult(initial, action.id, {
      schemaVersion: 1, kind: 'RETRY_COMPLETED', completedAt: nextTime,
    })).toThrow(/requires ASSESSMENT_COMPLETED/);

    const ready = submitResult(initial, action.id, {
      schemaVersion: 1, kind: 'ASSESSMENT_COMPLETED', assessment, completedAt: nextTime,
    });
    expect(() => submitResult(ready, action.id, {
      schemaVersion: 1, kind: 'ASSESSMENT_COMPLETED', assessment, completedAt: nextTime,
    })).toThrow(/expected action/);
    const execution = nextAction(ready);
    if (!execution) throw new Error('expected execution action');
    expect(() => submitResult(ready, execution.id, {
      schemaVersion: 1, kind: 'EXECUTION_COMPLETED', command: 'npm install other@1.0.0',
      status: 'succeeded', exitCode: 0, completedAt: nextTime,
    })).toThrow(/command does not match/);
  });

  it('rejects a previously submitted decision during reassessment', () => {
    const subject = intent();
    const retryAssessment = applicable(subject, {
      id: 'retry', kind: 'RETRY', expectedResult: 'retry',
    }, {
      rawVerdict: 'UNKNOWN', effectiveVerdict: 'UNKNOWN',
      errors: [{
        id: 'outage', kind: 'EVIDENCE_UNAVAILABLE', source: 'osv',
        retryability: 'retryable', decisionImpact: 'UNKNOWN', message: 'outage',
      }],
    });
    let state = assess(run(), retryAssessment);
    const retry = nextAction(state);
    if (!retry) throw new Error('expected retry');
    state = submitResult(state, retry.id, {
      schemaVersion: 1, kind: 'RETRY_COMPLETED', completedAt: nextTime,
    });

    expect(() => assess(state, retryAssessment)).toThrow(/already submitted/);
  });

  it('rejects malformed results, mismatched intent, and mismatched policy', () => {
    const state = run();
    const action = nextAction(state);
    if (!action) throw new Error('expected action');
    expect(() => submitResult(state, action.id, { kind: 'ASSESSMENT_COMPLETED' })).toThrow(/schema version 1/);

    const wrongIntent = applicable(intent('npm install other@1.0.0'), {
      id: 'safe', kind: 'EXECUTE_ALLOWED_ACTION', command: 'npm install other@1.0.0',
      expectedResult: 'execute',
    });
    expect(() => assess(state, wrongIntent)).toThrow(/subject does not match/);

    const wrongPolicy = applicable(intent(), {
      id: 'safe', kind: 'EXECUTE_ALLOWED_ACTION', command: intent().command,
      expectedResult: 'execute',
    }, { policy: { digest: 'sha256:other' } });
    expect(() => assess(state, wrongPolicy)).toThrow(/policy digest/);
  });

  it('records execution failure and rejects any later result', () => {
    const subject = intent();
    let state = assess(run(), applicable(subject, {
      id: 'safe', kind: 'EXECUTE_ALLOWED_ACTION', command: subject.command,
      expectedResult: 'execute',
    }));
    const action = nextAction(state);
    if (!action) throw new Error('expected action');
    state = submitResult(state, action.id, {
      schemaVersion: 1, kind: 'EXECUTION_COMPLETED', command: subject.command,
      status: 'failed', exitCode: 1, error: 'package manager failed', completedAt: nextTime,
    });

    expect(state.phase).toBe('failed');
    expect(state.terminalReason).toBe('package manager failed');
    expect(state.error).toEqual({ message: 'package manager failed', actionId: action.id });
    expect(nextAction(state)).toBeNull();
    expect(() => submitResult(state, action.id, {
      schemaVersion: 1, kind: 'EXECUTION_COMPLETED', command: subject.command,
      status: 'succeeded', exitCode: 0, completedAt: nextTime,
    })).toThrow(/already failed/);
  });

  it('rejects tampered serialized state before planning', () => {
    const state = run();
    const tampered = structuredClone(state) as HawkeyeRunState;
    tampered.attempt = 9;

    expect(() => nextAction(tampered)).toThrowError(HarnessError);
    expect(() => nextAction(tampered)).toThrow(/integrity validation/);
  });

  it('rejects a pending command changed after an assessment', () => {
    const subject = intent();
    const state = assess(run(), applicable(subject, {
      id: 'safe', kind: 'EXECUTE_ALLOWED_ACTION', command: subject.command,
      expectedResult: 'execute',
    }));
    const tampered = structuredClone(state);
    if (!tampered.pendingAction) throw new Error('expected pending action');
    tampered.pendingAction.command = 'npm install attacker-controlled@1.0.0';

    expect(() => nextAction(tampered)).toThrow(/Pending action/);
  });
});
