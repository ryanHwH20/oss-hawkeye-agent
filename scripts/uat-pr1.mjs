#!/usr/bin/env node

import {
  assessAction,
  checkPackage,
  checkPackages,
  loadPolicyWithMetadata,
  policyDigest,
} from '../dist/index.js';

const ecosystems = [
  {
    label: 'JavaScript / TypeScript',
    system: 'NPM',
    name: 'is-number',
    version: '7.0.0',
    command: 'npm install is-number@7.0.0',
  },
  {
    label: 'Python',
    system: 'PYPI',
    name: 'idna',
    version: '3.7',
    command: 'pip install idna==3.7',
  },
  {
    label: 'Rust',
    system: 'CARGO',
    name: 'itoa',
    version: '1.0.11',
    command: 'cargo add itoa@1.0.11',
  },
  {
    label: 'Go',
    system: 'GO',
    name: 'github.com/google/uuid',
    version: 'v1.6.0',
    command: 'go get github.com/google/uuid@v1.6.0',
  },
  {
    label: 'Ruby',
    system: 'RUBYGEMS',
    name: 'rake',
    version: '13.2.1',
    command: 'gem install rake -v 13.2.1',
  },
  {
    label: '.NET / C#',
    system: 'NUGET',
    name: 'Newtonsoft.Json',
    version: '13.0.3',
    command: 'dotnet add package Newtonsoft.Json --version 13.0.3',
  },
  {
    label: 'Java / Kotlin',
    system: 'MAVEN',
    name: 'org.slf4j:slf4j-api',
    version: '2.0.13',
    command: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.13',
  },
];

const failures = [];
const inconclusive = [];
const rows = [];

function accept(condition, message) {
  if (!condition) failures.push(message);
}

console.log('PR1 maintainer UAT');
console.log('This assesses commands only. It does not run a package manager or install anything.\n');

accept(typeof assessAction === 'function', 'Public export assessAction is missing.');
accept(typeof checkPackage === 'function', 'Legacy public export checkPackage is missing.');
accept(typeof checkPackages === 'function', 'Legacy public export checkPackages is missing.');
accept(typeof loadPolicyWithMetadata === 'function', 'Public export loadPolicyWithMetadata is missing.');
accept(typeof policyDigest === 'function', 'Public export policyDigest is missing.');

const loaded = loadPolicyWithMetadata();
const reorderedPolicy = {
  ...loaded.policy,
  blockedLicenses: [...loaded.policy.blockedLicenses].reverse(),
};
const changedPolicy = {
  ...loaded.policy,
  minScorecardScore: loaded.policy.minScorecardScore + 1,
};

accept(loaded.ref.digest === policyDigest(reorderedPolicy),
  'Equivalent normalized policy content produced a different digest.');
accept(loaded.ref.digest !== policyDigest(changedPolicy),
  'A material policy change did not produce a different digest.');

for (const command of ['npm test', 'dotnet remove package Newtonsoft.Json']) {
  const result = await assessAction({ kind: 'shell_command', command, cwd: process.cwd() });
  accept(result.applicability === 'not_applicable',
    `Non-install command was treated as applicable: ${command}`);
}

for (const item of ecosystems) {
  try {
    const result = await assessAction({
      kind: 'shell_command',
      command: item.command,
      cwd: process.cwd(),
    });

    if (result.applicability !== 'applicable') {
      failures.push(`${item.label}: supported install command was not detected.`);
      rows.push({ ecosystem: item.label, coordinate: 'NOT DETECTED', raw: '-', effective: '-', nextAction: '-' });
      continue;
    }

    const pkg = result.decision.packages[0];
    const coordinate = pkg
      ? `${pkg.system}:${pkg.name}@${pkg.requestedVersion ?? '(unversioned)'}`
      : 'MISSING';

    accept(result.schemaVersion === 1 && result.decision.schemaVersion === 1,
      `${item.label}: schemaVersion is not 1.`);
    accept(pkg?.system === item.system, `${item.label}: expected system ${item.system}, received ${pkg?.system}.`);
    accept(pkg?.name === item.name, `${item.label}: expected package ${item.name}, received ${pkg?.name}.`);
    accept(pkg?.requestedVersion === item.version,
      `${item.label}: expected requested version ${item.version}, received ${pkg?.requestedVersion}.`);
    accept(/^sha256:[a-f0-9]{64}$/.test(result.decision.policy.digest),
      `${item.label}: policy digest is missing or malformed.`);
    if (result.decision.effectiveVerdict === 'UNKNOWN') {
      inconclusive.push(`${item.label}: ${result.decision.errors.map(error => error.message).join('; ') || 'required evidence unavailable'}`);
    }

    rows.push({
      ecosystem: item.label,
      coordinate,
      raw: result.decision.rawVerdict,
      effective: result.decision.effectiveVerdict,
      nextAction: result.nextAction.kind,
    });
  } catch (error) {
    failures.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`);
    rows.push({ ecosystem: item.label, coordinate: 'ERROR', raw: '-', effective: '-', nextAction: '-' });
  }
}

console.table(rows);
console.log(`Policy source: ${loaded.source.kind} (${loaded.source.path})`);
console.log(`Policy digest: ${loaded.ref.digest}`);

if (failures.length > 0) {
  console.error('\nUAT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (inconclusive.length > 0) {
  console.error('\nUAT INCONCLUSIVE: the contract passed, but live evidence was unavailable for one or more ecosystems.');
  for (const item of inconclusive) console.error(`- ${item}`);
  console.error('Retry with network access before signing off PR1.');
  process.exitCode = 1;
} else {
  console.log('\nUAT PASSED: public API, policy identity, applicability boundary, live evidence, and all seven ecosystem coordinates are intact.');
  console.log('SAFE and BLOCKED values are observations, not fixed expectations; evidence changes over time.');
}
