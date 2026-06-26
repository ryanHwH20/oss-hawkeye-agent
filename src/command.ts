import type { CheckResult, Policy, Verdict } from './types.js';
import { detectAndParse } from './parser.js';
import { checkPackage, checkPackages } from './checker.js';
import { aggregateVerdict } from './util/verdict.js';
import { remediatePackage, type PackageRemediation } from './util/remediation.js';
import { loadExceptions, matchException, type Exception } from './util/exceptions.js';

/** Short, human/agent-friendly summary of why a result did not pass. */
function blockSummary(r: CheckResult): string {
  const v = r.violations.find(x => x.severity !== 'LOW') ?? r.violations[0];
  if (v) return `${v.reason}${v.affectedDep ? ` in ${v.affectedDep}` : ''}`;
  return r.unverified.join('; ') || 'did not pass audit';
}

/**
 * Re-audit each proposed upgrade so we never hand the agent a "fix" that is
 * itself blocked (e.g. a patched root version that still pulls a vulnerable
 * transitive dependency). A verified upgrade keeps `action: 'upgrade'`; an
 * unverifiable one degrades to `find-alternative` with an honest reason.
 */
async function verifyRemediations(
  remediation: PackageRemediation[],
  policy: Policy
): Promise<PackageRemediation[]> {
  return Promise.all(
    remediation.map(async rem => {
      if (rem.action !== 'upgrade' || !rem.recommendedVersion) return rem;
      const check = await checkPackage(rem.system, rem.name, rem.recommendedVersion, policy);
      if (check.verdict === 'SAFE') {
        return { ...rem, verified: true, reason: `${rem.reason} (verified clean)` };
      }
      return {
        ...rem,
        action: 'find-alternative' as const,
        recommendedVersion: null,
        fix: null,
        verified: false,
        reason:
          `${rem.name}@${rem.current} is vulnerable, but the patched ${rem.recommendedVersion} ` +
          `still does not pass audit (${blockSummary(check)}). No fully clean version was found — ` +
          `choose an alternative package or request a documented exception.`,
      };
    })
  );
}

/** A non-passing package allowed to proceed via a documented exception. */
export interface AppliedOverride {
  name: string;
  version: string;
  originalVerdict: Verdict;
  reason: string;
  approvedBy?: string;
}

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
  const cmd = command.trim();
  const parsed = cmd ? detectAndParse(cmd.split(/\s+/)) : null;

  if (!parsed || parsed.result.packages.length === 0) {
    return {
      detected: false, command: cmd, results: [],
      verdict: 'SAFE', effectiveVerdict: 'SAFE', overrides: [], remediation: [],
    };
  }

  const { system, packages } = parsed.result;
  const results = await checkPackages(
    packages.map(p => ({ system, name: p.name, version: p.version })),
    policy
  );

  // Apply documented exceptions: a non-passing package with an active exception
  // is allowed through (recorded as an override), and counts as SAFE toward the
  // enforced verdict.
  const overrides: AppliedOverride[] = [];
  const effectivePerPackage = results.map(r => {
    if (r.verdict === 'SAFE') return 'SAFE' as Verdict;
    const ex = matchException(exceptions, r.system, r.name, r.version);
    if (!ex) return r.verdict;
    overrides.push({
      name: r.name, version: r.version, originalVerdict: r.verdict,
      reason: ex.reason, approvedBy: ex.approvedBy,
    });
    return 'SAFE' as Verdict;
  });
  const effectiveVerdict: Verdict = effectivePerPackage.includes('BLOCKED')
    ? 'BLOCKED'
    : effectivePerPackage.includes('UNKNOWN')
      ? 'UNKNOWN'
      : 'SAFE';

  // Remediation is for packages that are *still* blocking after exceptions.
  const overridden = new Set(overrides.map(o => `${o.name}@${o.version}`));
  const candidates = results
    .filter(r => r.verdict !== 'SAFE' && !overridden.has(`${r.name}@${r.version}`))
    .map(remediatePackage);
  const remediation = await verifyRemediations(candidates, policy);

  return {
    detected: true, command: cmd, system, results,
    verdict: aggregateVerdict(results), effectiveVerdict, overrides, remediation,
  };
}
