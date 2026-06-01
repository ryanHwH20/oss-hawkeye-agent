// Standalone integration test — imports compiled dist files directly
// Usage: node test/run-test.mjs

import { checkPackage } from '../dist/checker.js';
import { formatResult } from '../dist/formatter.js';
import { loadPolicy } from '../dist/policy.js';

const policy = loadPolicy();

async function test(ecosystem, pkg, version) {
  console.error(`\n🔍 Checking ${ecosystem}::${pkg}${version ? '@' + version : '@latest'}...\n`);
  const result = await checkPackage(ecosystem, pkg, version, policy);
  const report = formatResult(result);
  console.log(report);
}

// Test: NPM express
await test('NPM', 'express', undefined);
