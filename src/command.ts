import type { CheckResult, Policy, Verdict } from './types.js';
import { detectAndParse } from './parser.js';
import { checkPackage, checkPackages } from './checker.js';
import { aggregateVerdict } from './util/verdict.js';
import { remediatePackage, type PackageRemediation } from './util/remediation.js';

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

export interface CommandAudit {
  /** Whether the command was recognized as a package-install command. */
  detected: boolean;
  command: string;
  system?: string;
  results: CheckResult[];
  verdict: Verdict;
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
export async function auditCommand(command: string, policy: Policy): Promise<CommandAudit> {
  const cmd = command.trim();
  const parsed = cmd ? detectAndParse(cmd.split(/\s+/)) : null;

  if (!parsed || parsed.result.packages.length === 0) {
    return { detected: false, command: cmd, results: [], verdict: 'SAFE', remediation: [] };
  }

  const { system, packages } = parsed.result;
  const results = await checkPackages(
    packages.map(p => ({ system, name: p.name, version: p.version })),
    policy
  );

  const candidates = results.filter(r => r.verdict !== 'SAFE').map(remediatePackage);
  const remediation = await verifyRemediations(candidates, policy);
  return { detected: true, command: cmd, system, results, verdict: aggregateVerdict(results), remediation };
}
