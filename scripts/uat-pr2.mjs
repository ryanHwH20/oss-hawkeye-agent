#!/usr/bin/env node

import {
  checkPackage,
  collectPackageEvidence,
  evaluatePackage,
  loadPolicyWithMetadata,
} from '../dist/index.js';

const packages = [
  { label: 'JavaScript / TypeScript', system: 'NPM', name: 'is-number', version: '7.0.0' },
  { label: 'Python', system: 'PYPI', name: 'idna', version: '3.7' },
  { label: 'Rust', system: 'CARGO', name: 'itoa', version: '1.0.11' },
  { label: 'Go', system: 'GO', name: 'github.com/google/uuid', version: 'v1.6.0' },
  { label: 'Ruby', system: 'RUBYGEMS', name: 'rake', version: '13.2.1' },
  { label: '.NET / C#', system: 'NUGET', name: 'Newtonsoft.Json', version: '13.0.3' },
  { label: 'Java / Kotlin', system: 'MAVEN', name: 'org.slf4j:slf4j-api', version: '2.0.13' },
];

const { policy, source } = loadPolicyWithMetadata();
const failures = [];
const inconclusive = [];
const rows = [];

function accept(condition, message) {
  if (!condition) failures.push(message);
}

function sourceStatuses(evidence) {
  return [
    ['metadata', evidence.metadata.status],
    ['dependency graph', evidence.dependencyGraph.status],
    ['OSV', evidence.vulnerabilities.status],
    ['Scorecard', evidence.scorecard.status],
    ...evidence.dependencies.flatMap(dependency => [
      [`${dependency.dependency.versionKey.name} metadata`, dependency.metadata.status],
      [`${dependency.dependency.versionKey.name} OSV`, dependency.vulnerabilities.status],
    ]),
  ];
}

console.log('PR2 maintainer UAT');
console.log('This collects and evaluates evidence only. It does not install packages.\n');

for (const item of packages) {
  try {
    const request = { system: item.system, name: item.name, version: item.version };
    const evidence = await collectPackageEvidence(request);
    const evidenceBefore = structuredClone(evidence);
    const first = evaluatePackage(evidence, policy);
    const second = evaluatePackage(evidence, policy);
    const legacy = await checkPackage(item.system, item.name, item.version, policy);
    const unavailable = sourceStatuses(evidence).filter(([, status]) => status === 'unavailable');

    accept(evidence.subject.system === item.system,
      `${item.label}: expected system ${item.system}, received ${evidence.subject.system}.`);
    accept(evidence.subject.name === item.name,
      `${item.label}: expected package ${item.name}, received ${evidence.subject.name}.`);
    accept(evidence.subject.requestedVersion === item.version,
      `${item.label}: requested version was not preserved.`);
    accept(JSON.stringify(first) === JSON.stringify(second),
      `${item.label}: repeated evaluation of the same evidence changed.`);
    accept(JSON.stringify(evidence) === JSON.stringify(evidenceBefore),
      `${item.label}: evaluation mutated the collected evidence.`);
    accept(JSON.stringify(first) === JSON.stringify(legacy),
      `${item.label}: legacy checkPackage differs from the Decision Kernel result.`);

    if (unavailable.length > 0) {
      inconclusive.push(`${item.label}: ${unavailable.map(([name]) => name).join(', ')} unavailable`);
    }

    rows.push({
      ecosystem: item.label,
      coordinate: `${evidence.subject.system}:${evidence.subject.name}@${evidence.subject.resolvedVersion}`,
      metadata: evidence.metadata.status,
      graph: evidence.dependencyGraph.status,
      osv: evidence.vulnerabilities.status,
      scorecard: evidence.scorecard.status,
      verdict: first.verdict,
      deterministic: JSON.stringify(first) === JSON.stringify(second) ? 'yes' : 'NO',
      compatible: JSON.stringify(first) === JSON.stringify(legacy) ? 'yes' : 'NO',
    });
  } catch (error) {
    failures.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`);
    rows.push({ ecosystem: item.label, coordinate: 'ERROR', verdict: '-', deterministic: 'NO', compatible: 'NO' });
  }
}

console.table(rows);
console.log(`Policy source: ${source.kind} (${source.path})`);

if (failures.length > 0) {
  console.error('\nUAT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (inconclusive.length > 0) {
  console.error('\nUAT INCONCLUSIVE: the kernel contract passed, but live evidence was unavailable.');
  for (const item of inconclusive) console.error(`- ${item}`);
  console.error('Retry with network access before signing off PR2.');
  process.exitCode = 1;
} else {
  console.log('\nUAT PASSED: evidence collection, deterministic evaluation, and legacy compatibility hold across all seven ecosystems.');
  console.log('SAFE and BLOCKED are live observations; their exact values may change with upstream evidence.');
}
