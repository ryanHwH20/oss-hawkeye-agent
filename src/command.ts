import type { CheckResult, Policy, Verdict } from './types.js';
import { detectAndParse } from './parser.js';
import { checkPackages } from './checker.js';
import { aggregateVerdict } from './util/verdict.js';

export interface CommandAudit {
  /** Whether the command was recognized as a package-install command. */
  detected: boolean;
  command: string;
  system?: string;
  results: CheckResult[];
  verdict: Verdict;
}

/**
 * Audit the package(s) an install command would add. This is the primitive
 * behind the install guardrail: given a shell command like
 * `npm install lodash express`, parse the intent, audit each package, and
 * return an aggregated verdict. A command that installs nothing is `detected:
 * false` and SAFE (nothing to gate).
 */
export async function auditCommand(command: string, policy: Policy): Promise<CommandAudit> {
  const cmd = command.trim();
  const parsed = cmd ? detectAndParse(cmd.split(/\s+/)) : null;

  if (!parsed || parsed.result.packages.length === 0) {
    return { detected: false, command: cmd, results: [], verdict: 'SAFE' };
  }

  const { system, packages } = parsed.result;
  const results = await checkPackages(
    packages.map(p => ({ system, name: p.name, version: p.version })),
    policy
  );

  return { detected: true, command: cmd, system, results, verdict: aggregateVerdict(results) };
}
