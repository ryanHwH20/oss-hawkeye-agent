import type { AppliedOverride } from './core/decision.js';
import { assessActionDetailed } from './runtime/assess-action.js';
import { mapLegacyCommandAudit } from './runtime/map-legacy-result.js';
import type { CheckResult, Policy, Verdict } from './types.js';
import { loadExceptions, type Exception } from './util/exceptions.js';
import type { PackageRemediation } from './util/remediation.js';

export type { AppliedOverride } from './core/decision.js';

export interface CommandAudit {
  /** Whether the command was recognized as a package-install command. */
  detected: boolean;
  command: string;
  system?: string;
  results: CheckResult[];
  /** Raw audited verdict from the package checks. */
  verdict: Verdict;
  /**
   * Enforced verdict after documented exceptions are applied. This is what the
   * exit code / install decision is based on — an override turns a BLOCKED or
   * UNKNOWN package into an allowed one.
   */
  effectiveVerdict: Verdict;
  /** Non-passing packages allowed through via `.hawkeye-exceptions.yaml`. */
  overrides: AppliedOverride[];
  /**
   * Machine-actionable next steps for each non-passing package, so an AI agent
   * can self-correct (e.g. re-install a patched version) instead of just
   * stopping. Empty when the command is approved or installs nothing.
   */
  remediation: PackageRemediation[];
}

/**
 * Audit the package(s) an install command would add. This is the primitive
 * behind the install guardrail: given a shell command like
 * `npm install lodash express`, parse the intent, audit each package, and
 * return an aggregated verdict. A command that installs nothing is `detected:
 * false` and SAFE (nothing to gate).
 */
export async function auditCommand(
  command: string,
  policy: Policy,
  exceptions: Exception[] = loadExceptions()
): Promise<CommandAudit> {
  const details = await assessActionDetailed(
    { kind: 'shell_command', command, cwd: process.cwd() },
    { policy, exceptions }
  );
  return mapLegacyCommandAudit(details);
}
