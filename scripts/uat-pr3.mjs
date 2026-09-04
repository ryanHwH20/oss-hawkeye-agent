#!/usr/bin/env node

import {
  assessAction,
  createRun,
  HarnessError,
  loadPolicy,
  nextAction,
  policyDigest,
  submitResult,
} from '../dist/index.js';

const cases = [
  { label: 'JavaScript / TypeScript', system: 'NPM', command: 'npm install is-number@7.0.0' },
  { label: 'Python', system: 'PYPI', command: 'pip install idna==3.7' },
  { label: 'Rust', system: 'CARGO', command: 'cargo add itoa@1.0.11' },
  { label: 'Go', system: 'GO', command: 'go get github.com/google/uuid@v1.6.0' },
  { label: 'Ruby', system: 'RUBYGEMS', command: 'gem install rake -v 13.2.1' },
  { label: '.NET / C#', system: 'NUGET', command: 'dotnet add package Newtonsoft.Json --version 13.0.3' },
  { label: 'Java / Kotlin', system: 'MAVEN', command: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.13' },
];

const policy = loadPolicy();
const policyRef = {
  ...(policy.organizationName ? { id: policy.organizationName } : {}),
  digest: policyDigest(policy),
};
const failures = [];
const rows = [];

function accept(condition, message) {
  if (!condition) failures.push(message);
}

function resultFor(action, at) {
  if (action.kind === 'EXECUTE_ALLOWED_ACTION' || action.kind === 'TRY_VERIFIED_REMEDIATION') {
    return {
      schemaVersion: 1, kind: 'EXECUTION_COMPLETED', command: action.command,
      status: 'succeeded', exitCode: 0, completedAt: at,
    };
  }
  if (action.kind === 'RETRY') return { schemaVersion: 1, kind: 'RETRY_COMPLETED', completedAt: at };
  if (action.kind === 'REQUEST_HUMAN_APPROVAL') {
    return {
      schemaVersion: 1, kind: 'APPROVAL_REQUESTED', completedAt: at,
      externalReference: 'uat-request-only',
    };
  }
  if (action.kind === 'STOP') return { schemaVersion: 1, kind: 'STOPPED', completedAt: at };
  throw new Error(`UAT does not simulate ${action.kind}.`);
}

console.log('PR3 maintainer UAT');
console.log('This assesses and simulates workflow results only. It never executes package-manager commands.\n');

for (const [index, item] of cases.entries()) {
  try {
    const intent = { kind: 'shell_command', command: item.command, cwd: process.cwd() };
    const run = createRun(intent, policyRef, {
      runId: `uat-${index + 1}`,
      now: () => new Date('2026-09-03T08:00:00.000Z'),
    });
    const assessmentAction = nextAction(run);
    const assessment = await assessAction(intent, { policy });
    if (!assessmentAction) throw new Error('new run did not produce ASSESS');
    const assessed = submitResult(run, assessmentAction.id, {
      schemaVersion: 1,
      kind: 'ASSESSMENT_COMPLETED',
      assessment,
      completedAt: '2026-09-03T08:01:00.000Z',
    });
    const action = nextAction(assessed);
    const restored = JSON.parse(JSON.stringify(assessed));
    const replayed = nextAction(restored);
    const replayMatches = JSON.stringify(action) === JSON.stringify(replayed);

    accept(assessment.applicability === 'applicable', `${item.label}: install command was not applicable.`);
    if (assessment.applicability === 'applicable') {
      accept(assessment.decision.packages[0]?.system === item.system,
        `${item.label}: expected ${item.system} coordinate.`);
      accept(assessment.decision.policy.digest === policyRef.digest,
        `${item.label}: policy digest changed between run and assessment.`);
    }
    accept(replayMatches, `${item.label}: JSON resume changed the next action.`);
    accept(action !== null, `${item.label}: applicable assessment had no next action.`);

    let finalState = assessed;
    if (action) {
      finalState = submitResult(
        assessed,
        action.id,
        resultFor(action, '2026-09-03T08:02:00.000Z'),
      );
    }

    rows.push({
      ecosystem: item.label,
      coordinate: assessment.applicability === 'applicable'
        ? `${assessment.decision.packages[0]?.system}:${assessment.decision.packages[0]?.name}@${assessment.decision.packages[0]?.resolvedVersion}`
        : 'not applicable',
      verdict: assessment.applicability === 'applicable' ? assessment.decision.effectiveVerdict : '-',
      action: action?.kind ?? '-',
      replay: replayMatches ? 'yes' : 'NO',
      phase: finalState.phase,
    });
  } catch (error) {
    failures.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`);
    rows.push({ ecosystem: item.label, coordinate: 'ERROR', verdict: '-', action: '-', replay: 'NO', phase: 'failed' });
  }
}

// Negative protocol check: an old action ID must never advance a run.
try {
  const staleRun = createRun(
    { kind: 'shell_command', command: 'npm install is-number@7.0.0' },
    policyRef,
    { runId: 'uat-stale', now: () => new Date('2026-09-03T08:00:00.000Z') },
  );
  submitResult(staleRun, 'old-action-id', {
    schemaVersion: 1,
    kind: 'RETRY_COMPLETED',
    completedAt: '2026-09-03T08:01:00.000Z',
  });
  failures.push('Stale-result check: an unexpected action ID was accepted.');
} catch (error) {
  accept(error instanceof HarnessError && error.code === 'ACTION_MISMATCH',
    'Stale-result check did not return ACTION_MISMATCH.');
}

// Deterministic synthetic UNKNOWN proves that retry cannot loop forever.
try {
  const retryIntent = { kind: 'shell_command', command: 'npm install retry-fixture@1.0.0' };
  const retryAssessment = {
    schemaVersion: 1,
    applicability: 'applicable',
    decision: {
      schemaVersion: 1,
      id: 'uat-unknown-decision',
      subject: retryIntent,
      packages: [{ system: 'NPM', name: 'retry-fixture', requestedVersion: '1.0.0', resolvedVersion: '1.0.0' }],
      rawVerdict: 'UNKNOWN', effectiveVerdict: 'UNKNOWN', findings: [], evidence: [],
      errors: [{
        id: 'uat-provider-error', kind: 'EVIDENCE_UNAVAILABLE', source: 'osv',
        retryability: 'retryable', decisionImpact: 'UNKNOWN', message: 'synthetic outage',
      }],
      overrides: [], remediation: [], policy: policyRef,
      decidedAt: '2026-09-03T08:00:30.000Z',
    },
    nextAction: {
      id: 'one-shot-retry', kind: 'RETRY', retryAfterMs: 1000,
      reason: 'Required evidence is temporarily unavailable.', expectedResult: 'reassess',
    },
  };
  let retryState = createRun(retryIntent, policyRef, {
    runId: 'uat-retry', maxAttempts: 2,
    now: () => new Date('2026-09-03T08:00:00.000Z'),
  });
  let action = nextAction(retryState);
  retryState = submitResult(retryState, action.id, {
    schemaVersion: 1, kind: 'ASSESSMENT_COMPLETED', assessment: retryAssessment,
    completedAt: '2026-09-03T08:01:00.000Z',
  });
  action = nextAction(retryState);
  retryAssessment.decision.id = 'uat-unknown-decision-2';
  retryState = submitResult(retryState, action.id, {
    schemaVersion: 1, kind: 'RETRY_COMPLETED', completedAt: '2026-09-03T08:02:00.000Z',
  });
  action = nextAction(retryState);
  retryState = submitResult(retryState, action.id, {
    schemaVersion: 1, kind: 'ASSESSMENT_COMPLETED', assessment: retryAssessment,
    completedAt: '2026-09-03T08:03:00.000Z',
  });
  accept(nextAction(retryState)?.kind === 'STOP', 'Retry budget did not terminate with STOP.');
} catch (error) {
  failures.push(`Retry-budget check: ${error instanceof Error ? error.message : String(error)}`);
}

console.table(rows);
console.log('Protocol checks: stale action rejected; retry budget stops after 2 assessments.');

if (failures.length > 0) {
  console.error('\nUAT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nUAT PASSED: all seven ecosystems resume deterministically and obey the Harness workflow.');
  console.log('Execution results were simulated; no package-manager command was run.');
}
