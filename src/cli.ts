#!/usr/bin/env node
import { resolve } from 'node:path';
import { checkPackage } from './checker.js';
import { scanProject } from './scan/scan.js';
import { auditCommand } from './command.js';
import { formatResult, formatScanReport } from './formatter.js';
import { toSarif, toSarifReport } from './sarif.js';
import { loadPolicy } from './policy.js';

function usage(): never {
  console.error('Usage: hawkeye <system> <package> [version] [--json|--sarif]');
  console.error('       hawkeye scan [path] [--json|--sarif]');
  console.error('Example: hawkeye NPM express 5.2.1');
  console.error('         hawkeye scan . --sarif > hawkeye.sarif');
  process.exit(2); // usage error — not a policy block
}

interface OutputMode {
  json: boolean;
  sarif: boolean;
  machine: boolean;
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
  const out: OutputMode = { json, sarif, machine };

  if (positional[0]?.toLowerCase() === 'scan') {
    return runScan(positional[1], out);
  }

  if (positional[0]?.toLowerCase() === 'check-command') {
    return runCheckCommand(positional[1], out);
  }

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

async function runScan(path: string | undefined, out: OutputMode): Promise<void> {
  const dir = path ?? '.';
  const policy = loadPolicy();

  if (!out.machine) {
    console.error(`🔍 Scanning project at ${resolve(dir)}...`);
  }

  const report = await scanProject(dir, policy);

  if (out.sarif) {
    console.log(JSON.stringify(toSarifReport(report.results), null, 2));
  } else if (out.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n' + formatScanReport(report));
  }

  // Same fail-closed exit semantics as a single-package audit.
  if (report.verdict === 'BLOCKED') {
    if (!out.machine) console.error('\n❌ Scan failed: one or more dependencies are blocked.');
    process.exit(1);
  } else if (report.verdict === 'UNKNOWN') {
    console.error(`${out.machine ? '' : '\n'}⚠️  Scan incomplete: some dependencies could not be verified. Failing closed.`);
    process.exit(1);
  } else {
    if (!out.machine) console.log('\n✅ Scan passed.');
    process.exit(0);
  }
}

async function runCheckCommand(command: string | undefined, out: OutputMode): Promise<void> {
  const policy = loadPolicy();
  const audit = await auditCommand(command ?? '', policy);

  if (out.sarif) {
    console.log(JSON.stringify(toSarifReport(audit.results), null, 2));
  } else if (out.json) {
    console.log(JSON.stringify(audit, null, 2));
  } else if (!audit.detected) {
    console.log('No package install detected — nothing to audit.');
  } else {
    const badge = audit.verdict === 'BLOCKED' ? '❌ BLOCKED'
      : audit.verdict === 'UNKNOWN' ? '⚠️ UNVERIFIED'
        : '✅ APPROVED';
    console.log(`\n# 🎾 Install Check — ${badge}\n`);
    console.log(`\`${audit.command}\` → ${audit.system}\n`);
    for (const r of audit.results) {
      const b = r.verdict === 'BLOCKED' ? '❌' : r.verdict === 'UNKNOWN' ? '⚠️' : '✅';
      const reason = r.verdict === 'BLOCKED'
        ? (r.violations.find(v => v.severity !== 'LOW')?.reason ?? 'Policy violation')
        : r.verdict === 'UNKNOWN' ? `unverified: ${r.unverified.join(', ')}` : '';
      console.log(`${b} \`${r.name}@${r.version}\`${reason ? ' — ' + reason : ''}`);
    }
    console.log('');
  }

  // Fail-closed exit codes — drives the PreToolUse hook decision.
  if (audit.verdict === 'BLOCKED') {
    if (!out.machine) console.error('❌ Install blocked by Hawkeye.');
    process.exit(1);
  } else if (audit.verdict === 'UNKNOWN') {
    console.error('⚠️  Install unverifiable — failing closed.');
    process.exit(1);
  } else {
    if (!out.machine && audit.detected) console.log('✅ Install approved.');
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
