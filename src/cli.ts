#!/usr/bin/env node
import { checkPackage } from './checker.js';
import { formatResult } from './formatter.js';
import { toSarif } from './sarif.js';
import { loadPolicy } from './policy.js';

function usage(): never {
  console.error('Usage: hawkeye <system> <package> [version] [--json|--sarif]');
  console.error('Example: hawkeye NPM express 5.2.1');
  console.error('         hawkeye NPM express 5.2.1 --sarif > hawkeye.sarif');
  process.exit(2); // usage error — not a policy block
}

async function main() {
  const raw = process.argv.slice(2);
  const flags = new Set(raw.filter(a => a.startsWith('--')));
  const positional = raw.filter(a => !a.startsWith('--'));

  const json = flags.has('--json');
  const sarif = flags.has('--sarif');
  if (json && sarif) {
    console.error('Error: choose only one of --json or --sarif.');
    process.exit(2);
  }
  // In machine-output mode, stdout carries ONLY the JSON/SARIF document; all
  // human-facing chatter goes to stderr so the output stays pipeable.
  const machine = json || sarif;

  if (positional.length < 2) usage();

  const system = positional[0].toUpperCase();
  const pkg = positional[1];
  const version = positional[2]; // optional
  const policy = loadPolicy();

  if (!machine) {
    console.log(`🔍 Context-Aware Security Guardrail: Checking ${system}::${pkg}${version ? `@${version}` : ''}...`);
  }

  const result = await checkPackage(system, pkg, version, policy);

  if (sarif) {
    console.log(JSON.stringify(toSarif(result), null, 2));
  } else if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n' + formatResult(result));
  }

  // Fail-closed: BLOCKED and UNKNOWN both exit non-zero. A security guardrail
  // must never return success when it could not actually verify the package.
  if (result.verdict === 'BLOCKED') {
    if (!machine) console.error('\n❌ Audit failed: Blocking security or license issues found.');
    process.exit(1);
  } else if (result.verdict === 'UNKNOWN') {
    console.error(`${machine ? '' : '\n'}⚠️  Audit incomplete: could not verify ${result.unverified.join(', ')}. Failing closed.`);
    process.exit(1);
  } else {
    if (!machine) console.log('\n✅ Audit passed.');
    process.exit(0);
  }
}

main().catch(err => {
  // Exit codes: 0 = pass, 1 = policy block / unverifiable (fail-closed),
  // 2 = the tool itself failed to run. Keeping these distinct lets CI tell a
  // genuinely blocked package apart from a broken audit.
  console.error('An unexpected error occurred:', err);
  process.exit(2);
});
