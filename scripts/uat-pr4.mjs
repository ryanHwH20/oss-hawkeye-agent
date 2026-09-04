#!/usr/bin/env node

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { nextAction } from '../dist/index.js';

const require = createRequire(import.meta.url);
const { createMemoryChatService } = require('../adapters/vscode/dist/runtime.js');

const cases = [
  { label: 'JavaScript / TypeScript', system: 'NPM', command: 'npm install is-number@7.0.0' },
  { label: 'Python', system: 'PYPI', command: 'pip install idna==3.7' },
  { label: 'Rust', system: 'CARGO', command: 'cargo add itoa@1.0.11' },
  { label: 'Go', system: 'GO', command: 'go get github.com/google/uuid@v1.6.0' },
  { label: 'Ruby', system: 'RUBYGEMS', command: 'gem install rake -v 13.2.1' },
  { label: '.NET / C#', system: 'NUGET', command: 'dotnet add package Newtonsoft.Json --version 13.0.3' },
  { label: 'Java / Kotlin', system: 'MAVEN', command: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.13' },
];

const failures = [];
const rows = [];

function accept(condition, message) {
  if (!condition) failures.push(message);
}

console.log('PR4 maintainer UAT');
console.log('This invokes the compiled @oss-hawkeye chat runtime. It never executes package-manager commands.\n');

for (const [index, item] of cases.entries()) {
  try {
    let tick = 0;
    const { service, store } = createMemoryChatService({
      fallbackPolicyPath: resolve('adapters/vscode/policy.json'),
      runId: () => `uat-chat-${index + 1}`,
      now: () => new Date(Date.parse('2026-09-04T01:00:00.000Z') + tick++ * 1000),
    });
    const checked = await service.handle({ command: 'check', prompt: item.command, cwd: process.cwd() });
    const state = await store.load();
    const restored = JSON.parse(JSON.stringify(state));
    const originalAction = nextAction(state);
    const restoredAction = nextAction(restored);
    const replay = JSON.stringify(originalAction) === JSON.stringify(restoredAction);
    const status = await service.handle({ command: 'status', prompt: '', cwd: process.cwd() });
    const decision = state?.decisions?.at(-1);
    const coordinate = decision?.packages?.[0];

    accept(decision !== undefined, `${item.label}: chat check did not persist a decision.`);
    accept(coordinate?.system === item.system,
      `${item.label}: expected ${item.system}, received ${coordinate?.system ?? 'none'}.`);
    accept(state?.intent?.command === item.command, `${item.label}: exact command was not preserved.`);
    accept(replay, `${item.label}: JSON restore changed the next action.`);
    accept(checked.markdown.includes('Chat guidance does not bypass'),
      `${item.label}: enforcement boundary is absent from the response.`);
    accept(status.markdown.includes(originalAction?.kind ?? 'This workflow is complete'),
      `${item.label}: /status does not reflect the canonical next action.`);

    let fix = '-';
    if (originalAction?.kind === 'TRY_VERIFIED_REMEDIATION') {
      const response = await service.handle({ command: 'fix', prompt: '', cwd: process.cwd() });
      accept(response.markdown.includes(originalAction.command),
        `${item.label}: /fix omitted the verified command.`);
      accept(response.markdown.includes('has not been executed'),
        `${item.label}: /fix did not state the no-execution boundary.`);
      fix = 'verified';
    }

    rows.push({
      ecosystem: item.label,
      coordinate: coordinate
        ? `${coordinate.system}:${coordinate.name}@${coordinate.resolvedVersion}`
        : 'ERROR',
      verdict: decision?.effectiveVerdict ?? '-',
      chatStatus: checked.status,
      action: originalAction?.kind ?? '-',
      replay: replay ? 'yes' : 'NO',
      fix,
    });
  } catch (error) {
    failures.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`);
    rows.push({
      ecosystem: item.label, coordinate: 'ERROR', verdict: '-', chatStatus: 'error',
      action: '-', replay: 'NO', fix: '-',
    });
  }
}

console.table(rows);

if (failures.length > 0) {
  console.error('\nUAT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nUAT PASSED: compiled @oss-hawkeye checks and resumes all seven ecosystems.');
  console.log('No package-manager command was executed.');
}
