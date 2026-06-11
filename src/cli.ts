#!/usr/bin/env node
import { checkPackage } from './checker.js';
import { formatResult } from './formatter.js';
import { loadPolicy } from './policy.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: hawkeye <system> <package> [version]');
    console.error('Example: hawkeye NPM express 5.2.1');
    process.exit(1);
  }

  const system = args[0].toUpperCase();
  const pkg = args[1];
  const version = args[2]; // optional
  const policy = loadPolicy();
  
  console.log(`🔍 Context-Aware Security Guardrail: Checking ${system}::${pkg}${version ? `@${version}` : ''}...`);
  const result = await checkPackage(system, pkg, version, policy);
  
  const report = formatResult(result);
  console.log('\n' + report);

  // Fail-closed: BLOCKED and UNKNOWN both exit non-zero. A security guardrail
  // must never return success when it could not actually verify the package.
  if (result.verdict === 'BLOCKED') {
    console.error('\n❌ Audit failed: Blocking security or license issues found.');
    process.exit(1);
  } else if (result.verdict === 'UNKNOWN') {
    console.error(`\n⚠️  Audit incomplete: could not verify ${result.unverified.join(', ')}. Failing closed.`);
    process.exit(1);
  } else {
    console.log('\n✅ Audit passed.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('An unexpected error occurred:', err);
  process.exit(1);
});
