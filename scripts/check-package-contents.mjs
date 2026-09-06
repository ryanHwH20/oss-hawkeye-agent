#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPackageFiles, REQUIRED_PACKAGE_FILES } from './lib/package-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = mkdtempSync(resolve(tmpdir(), 'hawkeye-package-check-'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let packed;

try {
  packed = spawnSync(npmCommand, [
    'pack', '--json', '--dry-run', '--ignore-scripts', '--cache', cache,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
} finally {
  rmSync(cache, { recursive: true, force: true });
}

if (packed.status !== 0) {
  process.stderr.write(packed.stderr);
  process.exit(packed.status ?? 1);
}

const result = JSON.parse(packed.stdout)[0];
assertPackageFiles(result.files);
console.log(`Package contract passed: ${REQUIRED_PACKAGE_FILES.length} required artifacts are present in ${result.filename}.`);
