#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseTag } from './lib/release-version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const tag = process.argv[2];

if (!tag) {
  console.error('Usage: npm run check:release-version -- v<package-version>');
  process.exit(2);
}

assertReleaseTag(packageJson.version, tag);
console.log(`Release tag ${tag} matches package version ${packageJson.version}.`);
