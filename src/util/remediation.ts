import semver from 'semver';
import type { CheckResult } from '../types.js';

/**
 * Pick upgrade targets from a set of fixed versions:
 *  - `minimal`: the closest same-major.minor patch above `current` (no breaking
 *    change), falling back to the highest fixed version.
 *  - `latest`: the highest fixed version.
 * Non-semver versions (e.g. Maven) fall back to the last fixed version.
 */
export function findSmartUpgrades(current: string, fixedVersions: string[]) {
  const validFixed = fixedVersions.filter(v => semver.valid(v));
  if (validFixed.length === 0) {
    if (fixedVersions.length > 0) {
      const last = fixedVersions[fixedVersions.length - 1];
      return { minimal: last, latest: last };
    }
    return { minimal: null, latest: null };
  }

  validFixed.sort(semver.compare);
  const latest = validFixed[validFixed.length - 1];

  const currentObj = semver.parse(current);
  let minimal = latest;
  if (currentObj) {
    const closestPatch = validFixed.find(v => {
      const vObj = semver.parse(v);
      return vObj && vObj.major === currentObj.major && vObj.minor === currentObj.minor && semver.gt(v, current);
    });
    if (closestPatch) minimal = closestPatch;
  }

  return { minimal, latest };
}

/** What the caller (or an AI agent) should do about a non-passing package. */
export type RemediationAction = 'upgrade' | 'find-alternative' | 'verify';

/**
 * A machine-actionable next step for one audited package. Designed so an AI
 * coding agent can read it and *self-correct* — e.g. on `action: 'upgrade'` it
 * can re-issue the install using `fix` (`name@version`) instead of stopping.
 */
export interface PackageRemediation {
  name: string;
  system: string;
  current: string;
  action: RemediationAction;
  /** The version to move to, or null when no safe upgrade exists. */
  recommendedVersion: string | null;
  /** Ready-to-install `name@version` for an `upgrade`, else null. */
  fix: string | null;
  /**
   * True when the recommended version was itself re-audited and passed. An
   * `upgrade` is only handed back to the agent once verified, so it never loops
   * on a "fix" that is itself blocked.
   */
  verified?: boolean;
  reason: string;
}

/**
 * Turn a blocked/unverifiable {@link CheckResult} into a single, concrete next
 * step. Only the root package is remediated by version swap — a transitive
 * issue can't be fixed by changing which version of the root you install, so it
 * routes to `find-alternative` instead of suggesting a misleading upgrade.
 */
export function remediatePackage(r: CheckResult): PackageRemediation {
  const base = { name: r.name, system: r.system, current: r.version };

  // 0. Looks like a typosquat → the safe move is almost always the real package.
  const squat = r.violations.find(v => v.type === 'TYPOSQUAT');
  if (squat) {
    const suggested = squat.affectedDep ?? 'the intended package';
    return {
      ...base,
      action: 'find-alternative',
      recommendedVersion: null,
      fix: null,
      reason: `${r.name} looks like a typosquat of "${suggested}". Did you mean "${suggested}"? If this package is genuinely intended, approve it via a documented exception.`,
    };
  }

  // 1. The root package itself has a vulnerability → upgrade to a patched one.
  const rootVulns = r.violations.filter(v => v.type === 'VULNERABILITY');
  if (rootVulns.length > 0) {
    const fixed = [...new Set(rootVulns.flatMap(v => v.fixedVersions ?? []))];
    // Recommend the HIGHEST fixed version: it is ≥ every individual fix, so it
    // provably clears all blocking CVEs. A "closest non-breaking" patch could
    // sit below a fix that only landed in a later release and silently leave
    // the package vulnerable — unacceptable for a security recommendation.
    const { latest } = findSmartUpgrades(r.version, fixed);
    const rec = latest;
    const cves = rootVulns.flatMap(v => v.details).slice(0, 3).join(', ');
    if (rec) {
      return {
        ...base,
        action: 'upgrade',
        recommendedVersion: rec,
        fix: `${r.name}@${rec}`,
        reason: `${r.name}@${r.version} is affected by ${cves || 'known vulnerabilities'}; ${rec} is patched. Re-run the install with ${r.name}@${rec}.`,
      };
    }
    return {
      ...base,
      action: 'find-alternative',
      recommendedVersion: null,
      fix: null,
      reason: `${r.name}@${r.version} has known vulnerabilities (${cves || 'see report'}) with no fixed version available. Choose a different package.`,
    };
  }

  // 2. Root license is blocked → no version change resolves a license.
  const lic = r.violations.find(v => v.type === 'LICENSE');
  if (lic) {
    return {
      ...base,
      action: 'find-alternative',
      recommendedVersion: null,
      fix: null,
      reason: `${r.name} uses a blocked license (${lic.details.join(', ')}). No version change resolves this — choose a differently-licensed package or request a documented exception.`,
    };
  }

  // 3. A transitive dependency is the problem → swapping the root version is
  // not a reliable fix; surface the offending dep instead.
  const sbom = r.violations.find(v => v.type === 'SBOM_VULNERABILITY' || v.type === 'SBOM_LICENSE');
  if (sbom) {
    return {
      ...base,
      action: 'find-alternative',
      recommendedVersion: null,
      fix: null,
      reason: `A transitive dependency of ${r.name} is blocked (${sbom.affectedDep ?? 'unknown'}: ${sbom.reason}). Pin/override the offending dependency or choose an alternative.`,
    };
  }

  // 4. Could not be verified → do not install until it can be.
  if (r.verdict === 'UNKNOWN') {
    return {
      ...base,
      action: 'verify',
      recommendedVersion: null,
      fix: null,
      reason: `${r.name}@${r.version} could not be verified (${r.unverified.join('; ') || 'sources unavailable'}). Do not install until it can be verified.`,
    };
  }

  return {
    ...base,
    action: 'find-alternative',
    recommendedVersion: null,
    fix: null,
    reason: `${r.name}@${r.version} did not pass policy.`,
  };
}
