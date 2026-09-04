#!/usr/bin/env node

import { createVSIX } from '@vscode/vsce';
import { resolve } from 'node:path';

const cwd = resolve('adapters/vscode');
const packagePath = resolve(cwd, 'oss-hawkeye-vscode-0.1.0.vsix');

await createVSIX({
  cwd,
  packagePath,
  dependencies: false,
});

console.log(`VSIX: ${packagePath}`);
