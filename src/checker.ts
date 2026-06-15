import type {
  CheckResult,
  Policy,
  DepLicense,
  Violation,
  ScorecardOfficialSeverity,
  OsvVuln,
} from './types.js';
import {
  getVersionInfo,
  getDependencies,
  getProjectScorecard,
  extractSourceRepoId,
  depsDevUrl,
} from './api/deps-dev.js';
import { queryVulnerabilities, queryVulnerabilitiesBatch } from './api/osv.js';
import { mapLimit } from './util/concurrency.js';
import { buildParentMap, dependencyPath } from './util/depgraph.js';
import { meetsBlockingThreshold } from './util/severity.js';
import { flaggedLicenses } from './util/license.js';

// Max concurrent deps.dev requests while enriching the dependency graph.
const DEP_CONCURRENCY = 8;

function osvSearchUrl(ecosystem: string, packageName: string): string {
  const ecosystemMap: Record<string, string> = {
    NPM: 'npm',
    PYPI: 'PyPI',
    CARGO: 'crates.io',
    GO: 'Go',
    RUBYGEMS: 'RubyGems',
    NUGET: 'NuGet',
    MAVEN: 'Maven',
  };
  const osvEco = ecosystemMap[ecosystem.toUpperCase()] ?? ecosystem;
  return `https://osv.dev/list?ecosystem=${encodeURIComponent(osvEco)}&q=${encodeURIComponent(packageName)}`;
}

// ─── OpenSSF Scorecard Official Severity Weights (PRD §2.2) ──────────────────

const SCORECARD_SEVERITY: Record<string, ScorecardOfficialSeverity> = {
  // 🚨 Critical Severity
  'Dangerous-Workflow':     'Critical',
  'Webhooks':               'Critical',
  // 🔴 High Severity
  'Binary-Artifacts':       'High',
  'Branch-Protection':      'High',
  'Code-Review':            'High',
  'Dependency-Update-Tool': 'High',
  'Maintained':             'High',
  'Signed-Releases':        'High',
  'Token-Permissions':      'High',
  'Vulnerabilities':        'High',
  // 🟡 Medium Severity
  'Fuzzing':                'Medium',
  'Packaging':              'Medium',
  'Pinned-Dependencies':    'Medium',
  'SAST':                   'Medium',
  'SBOM':                   'Medium',
  'Security-Policy':        'Medium',
  // 🟢 Low Severity
  'CI-Tests':               'Low',
  'CII-Best-Practices':     'Low',
  'Contributors':           'Low',
  'License':                'Low',
};

function getScorecardSeverity(checkName: string): ScorecardOfficialSeverity {
  return SCORECARD_SEVERITY[checkName] ?? 'Unknown';
}

/**
 * Check a single package against policy.
 * All external API calls are made in parallel via Promise.all for low latency.
 */
export async function checkPackage(
  ecosystem: string,
  packageName: string,
  version: string | undefined,
  policy: Policy
): Promise<CheckResult> {
  // Names of data sources we could not reach. Drives the fail-closed verdict
  // (critical sources) and the "unverified" disclosure in the report.
  const unverified: string[] = [];

  // ── Phase 1: resolve version (required before parallel fetch) ──────────────
  const versionRes = await getVersionInfo(ecosystem, packageName, version);
  const versionInfo = versionRes.value;
  const resolvedVersion = versionInfo?.versionKey?.version ?? version ?? 'latest';
  const licenses = versionInfo?.licenses ?? [];

  // ── Phase 2: parallel fetch — deps + scorecard + vulns ────────────────────
  // Reuse the version info we already fetched to locate the scorecard project,
  // instead of re-fetching it inside the scorecard lookup.
  const rootProjectId = extractSourceRepoId(versionInfo);
  const [depsRes, scorecardRes, vulnRes] = await Promise.all([
    getDependencies(ecosystem, packageName, resolvedVersion),
    rootProjectId
      ? getProjectScorecard(rootProjectId)
      : Promise.resolve({ value: null, status: 'ok' as const }),
    queryVulnerabilities(ecosystem, packageName, resolvedVersion),
  ]);
  const depsData = depsRes.value;
  const scorecardData = scorecardRes.value;
  const vulnerabilities = vulnRes.value;

  // Record unreachable sources. License/SBOM/vulnerabilities are *critical*:
  // if any is unavailable we cannot honestly clear the package. Scorecard is
  // advisory, so its absence is disclosed but does not force UNKNOWN.
  if (versionRes.status === 'unavailable') unverified.push('Package metadata & licenses (deps.dev)');
  if (depsRes.status === 'unavailable') unverified.push('Dependency graph / SBOM (deps.dev)');
  if (vulnRes.status === 'unavailable') unverified.push('Vulnerabilities (OSV)');
  if (scorecardRes.status === 'unavailable') unverified.push('OpenSSF Scorecard (deps.dev)');

  // ── Process dependencies ──────────────────────────────────────────────────
  const nodes = depsData?.nodes ?? [];
  const edges = depsData?.edges ?? [];
  const directDeps = nodes.filter(n => n.relation === 'DIRECT');
  const indirectDeps = nodes.filter(n => n.relation === 'INDIRECT');

  // Build the parent map (BFS from root) for dependency-path reconstruction.
  const parentMap = buildParentMap(nodes.length, edges);
  const getDependencyPath = (nodeId: number): string[] => dependencyPath(nodes, parentMap, nodeId);

  const allDeps = nodes.map((node, index) => ({ ...node, nodeId: index })).filter(n => n.relation !== 'SELF');

  // Step 1: enrich each dependency (licenses + scorecard) with bounded
  // concurrency so a large graph cannot fan out into hundreds of simultaneous
  // requests. Scorecard reuses the dep's own version info (no redundant fetch).
  const depMeta = await mapLimit(allDeps, DEP_CONCURRENCY, async (dep) => {
    const infoRes = await getVersionInfo(ecosystem, dep.versionKey.name, dep.versionKey.version);
    const info = infoRes.value;
    const projectId = extractSourceRepoId(info);
    const scorecardDepRes = projectId
      ? await getProjectScorecard(projectId)
      : { value: null, status: 'ok' as const };
    return {
      dep,
      info,
      infoUnavailable: infoRes.status === 'unavailable',
      scorecardScore: scorecardDepRes.value?.overallScore ?? null,
    };
  });

  // Step 2: collect the dependencies with known advisories and resolve their
  // vulnerabilities in a single OSV batch instead of one request each.
  const vulnTargetIdx: number[] = [];
  if (policy.blockVulnerabilities) {
    depMeta.forEach((m, idx) => {
      if (m.info?.advisoryKeys && m.info.advisoryKeys.length > 0) vulnTargetIdx.push(idx);
    });
  }
  const batchRes = await queryVulnerabilitiesBatch(
    vulnTargetIdx.map(idx => ({
      ecosystem,
      name: depMeta[idx].dep.versionKey.name,
      version: depMeta[idx].dep.versionKey.version,
    }))
  );
  const depVulnsByIdx = new Map<number, OsvVuln[]>();
  vulnTargetIdx.forEach((idx, i) => depVulnsByIdx.set(idx, batchRes.value[i] ?? []));
  const batchUnavailable = batchRes.status === 'unavailable';

  // Step 3: assemble per-dependency results. A dep is "unverified" when its
  // licenses or its advisory lookup could not be reached.
  const depInfos = depMeta.map((m, idx) => {
    const isVulnTarget = depVulnsByIdx.has(idx);
    const depVulnUnavailable = isVulnTarget && batchUnavailable;
    return {
      dep: m.dep,
      licenses: m.info?.licenses ?? [],
      scorecardScore: m.scorecardScore,
      depVulns: depVulnsByIdx.get(idx) ?? [],
      unverifiedDep: m.infoUnavailable || depVulnUnavailable,
    };
  });

  const depUnverifiedCount = depInfos.filter(d => d.unverifiedDep).length;
  if (depUnverifiedCount > 0) {
    unverified.push(`SBOM (${depUnverifiedCount} of ${allDeps.length} dependencies unverified)`);
  }

  const depLicenses: DepLicense[] = [];
  const sbomViolations: Violation[] = [];

  for (const { dep, licenses: depLicList, scorecardScore, depVulns } of depInfos) {
    const flagged = flaggedLicenses(depLicList, policy.blockedLicenses);
    const path = getDependencyPath(dep.nodeId);
    
    depLicenses.push({
      name: dep.versionKey.name,
      version: dep.versionKey.version,
      licenses: depLicList,
      flagged,
      relation: dep.relation as 'DIRECT' | 'INDIRECT',
      scorecardScore,
      path
    });

    if (flagged.length > 0) {
      sbomViolations.push({
        type: 'SBOM_LICENSE',
        severity: 'MEDIUM',
        reason: 'Transitive Dependency License Blocked',
        details: flagged,
        riskExplanation: `Transitive dependency ${dep.versionKey.name} uses restricted licenses (${flagged.join(', ')}). Copyleft viral clauses in deep dependencies may still enforce open-source requirements on proprietary products.`,
        affectedDep: `${dep.versionKey.name}@${dep.versionKey.version}`,
        path
      });
    }

    const blockingVulns = depVulns.filter(v => meetsBlockingThreshold(v.severity, policy.minBlockingSeverity));
    if (blockingVulns.length > 0) {
      sbomViolations.push({
        type: 'SBOM_VULNERABILITY',
        severity: 'HIGH',
        reason: 'Transitive Dependency Vulnerability Detected',
        details: blockingVulns.map(v => `${v.aliases.find(a => a.startsWith('CVE-')) ?? v.id} (${v.severity})`),
        riskExplanation: `Transitive dependency ${dep.versionKey.name} contains ${blockingVulns.length} vulnerabilities at or above the ${policy.minBlockingSeverity} threshold. While not directly imported, the vulnerability may be exploitable via the dependency chain.`,
        affectedDep: `${dep.versionKey.name}@${dep.versionKey.version}`,
        path,
        fixedVersions: blockingVulns.flatMap(v => v.fixedVersions)
      });
    }
  }

  // ── Process Scorecard ─────────────────────────────────────────────────────
  const scorecardScore = scorecardData?.overallScore ?? null;
  const scorecardDate = scorecardData?.date ?? null;
  const scorecardChecks = (scorecardData?.checks ?? []).map(c => ({
    name: c.name,
    score: c.score,
    officialSeverity: getScorecardSeverity(c.name),
    documentation: {
      shortDescription: c.documentation.shortDescription,
      url: c.documentation.url,
    },
  }));

  // ── Build violations ──────────────────────────────────────────────────────
  const violations: Violation[] = [...sbomViolations];
  const advisoryCount = vulnerabilities.length;

  // Root license violation
  const rootFlaggedLicenses = flaggedLicenses(licenses, policy.blockedLicenses);
  if (rootFlaggedLicenses.length > 0) {
    violations.push({
      type: 'LICENSE',
      severity: 'HIGH',
      reason: 'Direct Dependency License Blocked',
      details: rootFlaggedLicenses,
      riskExplanation: `The requested package uses a restricted license (${rootFlaggedLicenses.join(', ')}). This license contains copyleft clauses that could force proprietary derivatives to be open-sourced, posing a severe legal risk.`,
    });
  }

  // Vulnerability violation
  const blockingVulns = vulnerabilities.filter(
    v => meetsBlockingThreshold(v.severity, policy.minBlockingSeverity)
  );
  if (blockingVulns.length > 0 && policy.blockVulnerabilities) {
    violations.push({
      type: 'VULNERABILITY',
      severity: 'HIGH',
      reason: `Known Vulnerability at or above ${policy.minBlockingSeverity} severity`,
      details: blockingVulns.map(v => {
        const cve = v.aliases.find(a => a.startsWith('CVE-')) ?? v.id;
        return `${cve} (${v.severity}${v.cvssScore !== null ? ` · CVSS ${v.cvssScore.toFixed(1)}` : ''})`;
      }),
      riskExplanation: `This package version contains ${blockingVulns.length} known vulnerabilities at or above the ${policy.minBlockingSeverity} blocking threshold. Attackers can exploit these flaws, violating baseline security compliance.`,
      fixedVersions: blockingVulns.flatMap(v => v.fixedVersions)
    });
  }

  // Scorecard violation: overall score below threshold
  if (scorecardScore !== null && scorecardScore < policy.minScorecardScore) {
    violations.push({
      type: 'SCORECARD',
      severity: 'LOW',
      reason: 'OpenSSF Scorecard Security Posture Below Threshold',
      details: [`${scorecardScore.toFixed(1)}/10 (Minimum Threshold: ${policy.minScorecardScore}/10)`],
      riskExplanation: `The package has an OpenSSF Scorecard rating of ${scorecardScore.toFixed(1)}, falling below the recommended threshold of ${policy.minScorecardScore}/10. This may indicate immature security practices; proceed with caution.`,
    });
  }

  // Scorecard violation: any High-severity check scored 0 (PRD §2.2)
  const highSeverityZeroChecks = scorecardChecks.filter(
    c => c.officialSeverity === 'High' && c.score === 0
  );
  if (highSeverityZeroChecks.length > 0) {
    violations.push({
      type: 'SCORECARD',
      severity: 'LOW',
      reason: 'OpenSSF High-Severity Security Metrics scored 0 (Advisory)',
      details: highSeverityZeroChecks.map(c => `${c.name}: 0/10`),
      riskExplanation: `The following high-severity Scorecard metrics scored zero: ${highSeverityZeroChecks.map(c => c.name).join(', ')}. While not strictly blocked by current policy, this indicates potential supply chain security flaws and should be considered when adopting this package.`,
    });
  }



  // ── Compute fail-closed verdict ───────────────────────────────────────────
  // A policy violation always blocks. Otherwise, if any *critical* source
  // (licenses, SBOM, or vulnerabilities) was unreachable, we cannot honestly
  // approve the package — return UNKNOWN, which callers treat as non-passing.
  const hasBlocking = violations.some(v => v.severity === 'HIGH' || v.severity === 'MEDIUM');
  const criticalUnavailable =
    versionRes.status === 'unavailable' ||
    depsRes.status === 'unavailable' ||
    vulnRes.status === 'unavailable' ||
    depUnverifiedCount > 0;
  const verdict: import('./types.js').Verdict = hasBlocking
    ? 'BLOCKED'
    : criticalUnavailable
      ? 'UNKNOWN'
      : 'SAFE';

  return {
    name: packageName,
    version: resolvedVersion,
    system: ecosystem,
    licenses,
    rootFlaggedLicenses,
    advisoryCount,
    vulnerabilities,
    osvScannerUsed: false,
    scorecardScore,
    scorecardDate,
    scorecardChecks,
    depCount: { direct: directDeps.length, indirect: indirectDeps.length },
    depLicenses,
    violations,
    verdict,
    unverified,

    depsDevUrl: depsDevUrl(ecosystem, packageName, resolvedVersion),
    osvQueryUrl: osvSearchUrl(ecosystem, packageName),
    scorecardSourceUrl: scorecardData?.projectUrl ?? null,
  };
}

/**
 * Check multiple packages — each package is checked in parallel
 */
export async function checkPackages(
  packages: Array<{ system: string; name: string; version: string }>,
  policy: Policy
): Promise<CheckResult[]> {
  return Promise.all(
    packages.map(pkg => checkPackage(pkg.system, pkg.name, pkg.version || undefined, policy))
  );
}
