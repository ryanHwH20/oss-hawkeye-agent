#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'skills', 'oss-hawkeye', 'SKILL.md');
const targets = [
  resolve(root, '.agents', 'skills', 'oss-hawkeye', 'SKILL.md'),
  resolve(root, '.claude', 'skills', 'oss-hawkeye', 'SKILL.md'),
  resolve(root, '.github', 'skills', 'oss-hawkeye', 'SKILL.md'),
];
const checkOnly = process.argv.includes('--check');
const source = await readFile(sourcePath, 'utf8');
const drift = [];

for (const target of targets) {
  if (checkOnly) {
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current !== source) drift.push(target);
    continue;
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source);
  console.log(`Synced ${target.slice(root.length + 1)}`);
}

if (drift.length > 0) {
  console.error('Agent skill copies are missing or differ from skills/oss-hawkeye/SKILL.md:');
  for (const target of drift) console.error(`- ${target.slice(root.length + 1)}`);
  console.error('\nRun `npm run sync:skills` and commit the generated copies.');
  process.exit(1);
}

if (checkOnly) console.log('Agent skill copies match the canonical skill.');
