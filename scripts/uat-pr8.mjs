#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { assertPackageFiles } from './lib/package-contract.mjs';

const root = process.cwd();
const workflowSource = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
const workflow = parse(workflowSource);
const validate = workflow.jobs['validate-and-pack'];
const publish = workflow.jobs['publish-npm'];
const temporaryRoot = mkdtempSync(join(tmpdir(), 'hawkeye-pr8-'));
const packageOutput = join(temporaryRoot, 'release-artifact');
const cache = join(temporaryRoot, 'npm-cache');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const failures = [];

function accept(condition, message) {
  if (!condition) failures.push(message);
}

function commands(job) {
  return job.steps.map(step => step.run ?? '').join('\n');
}

console.log('PR8 maintainer UAT');
console.log('This validates the isolated release trust boundary and a real local tarball checksum.');
console.log('It never invokes npm publish.\n');

const validateCommands = commands(validate);
const publishCommands = commands(publish);
const publishCheckout = publish.steps.find(step => step.uses?.startsWith('actions/checkout@'));
const actions = Object.values(workflow.jobs).flatMap(job =>
  job.steps.map(step => step.uses).filter(Boolean),
);

const checks = [
  {
    boundary: 'Pinned toolchain',
    expected: 'Node 24.15.0 / npm 11.12.1',
    passed: workflow.env.RELEASE_NODE_VERSION === '24.15.0'
      && workflow.env.RELEASE_NPM_VERSION === '11.12.1'
      && !workflowSource.includes('npm@latest'),
  },
  {
    boundary: 'Validation permissions',
    expected: 'read-only, no OIDC',
    passed: validate.permissions?.contents === 'read' && !validate.permissions?.['id-token'],
  },
  {
    boundary: 'Seven ecosystems',
    expected: 'uat:pr7 before publish',
    passed: validateCommands.includes('npm run uat:pr7'),
  },
  {
    boundary: 'Publish permissions',
    expected: 'OIDC only in publish job',
    passed: publish.permissions?.contents === 'read'
      && publish.permissions?.['id-token'] === 'write'
      && publish.needs === 'validate-and-pack',
  },
  {
    boundary: 'No privileged build',
    expected: 'no install, build, or lifecycle scripts',
    passed: !publishCommands.includes('npm ci')
      && !publishCommands.includes('npm run build')
      && publishCommands.includes('npm publish "${tarballs[0]}" --ignore-scripts'),
  },
  {
    boundary: 'GitHub credentials',
    expected: 'checkout does not persist credentials',
    passed: publishCheckout?.with?.['persist-credentials'] === false,
  },
  {
    boundary: 'Immutable Actions',
    expected: 'all actions pinned to SHA',
    passed: actions.every(action => /^[^@]+@[0-9a-f]{40}$/.test(action)),
  },
  {
    boundary: 'Post-publish proof',
    expected: 'version, commit, integrity, provenance',
    passed: publishCommands.includes('${GITHUB_SHA}')
      && publishCommands.includes('${expected_integrity}')
      && publishCommands.includes('dist.attestations.provenance.predicateType')
      && publishCommands.includes('test "${provenance}" = ')
      && publishCommands.includes('exit 1'),
  },
];

for (const check of checks) accept(check.passed, `${check.boundary}: expected ${check.expected}.`);

try {
  mkdirSync(packageOutput);
  const packed = spawnSync(npmCommand, [
    'pack', '--json', '--ignore-scripts', '--pack-destination', packageOutput, '--cache', cache,
  ], { cwd: root, encoding: 'utf8' });
  if (packed.status !== 0) {
    throw new Error(packed.stderr || packed.stdout || 'npm pack failed');
  }

  const [packResult] = JSON.parse(packed.stdout);
  assertPackageFiles(packResult.files);
  const tarball = resolve(packageOutput, basename(packResult.filename));
  const actualIntegrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  accept(actualIntegrity === packResult.integrity,
    `Tarball integrity mismatch: expected ${packResult.integrity}, received ${actualIntegrity}.`);
  checks.push({
    boundary: 'Tarball integrity',
    expected: 'recomputed SHA-512 matches npm pack',
    passed: actualIntegrity === packResult.integrity,
  });
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  checks.push({ boundary: 'Tarball integrity', expected: 'recomputed SHA-512 matches npm pack', passed: false });
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.table(checks.map(check => ({
  boundary: check.boundary,
  expected: check.expected,
  result: check.passed ? 'PASS' : 'FAIL',
})));

if (failures.length > 0) {
  console.error('\nUAT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nUAT PASSED: release validation and OIDC publishing are isolated by an integrity-checked artifact.');
  console.log('No package was published.');
}
