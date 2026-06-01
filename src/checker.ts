import type {
  CheckResult,
  Policy,
  DepLicense,
  Violation,
  Alternative,
  ScorecardOfficialSeverity,
} from './types.js';
import { getVersionInfo, getDependencies, getScorecard, depsDevUrl } from './api/deps-dev.js';
import { queryVulnerabilities } from './api/osv.js';

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
  // ── Phase 1: resolve version (required before parallel fetch) ──────────────
  const versionInfo = await getVersionInfo(ecosystem, packageName, version);
  const resolvedVersion = versionInfo?.versionKey?.version ?? version ?? 'latest';
  const licenses = versionInfo?.licenses ?? [];

  // ── Phase 2: parallel fetch — deps + scorecard + vulns ────────────────────
  const [depsData, scorecardData, vulnerabilities] = await Promise.all([
    getDependencies(ecosystem, packageName, resolvedVersion),
    getScorecard(ecosystem, packageName, resolvedVersion),
    queryVulnerabilities(ecosystem, packageName, resolvedVersion),
  ]);

  // ── Process dependencies ──────────────────────────────────────────────────
  const nodes = depsData?.nodes ?? [];
  const edges = depsData?.edges ?? [];
  const directDeps = nodes.filter(n => n.relation === 'DIRECT');
  const indirectDeps = nodes.filter(n => n.relation === 'INDIRECT');

  // Build adjacency list & parent map for BFS pathfinding
  const parentMap = new Map<number, number>();
  if (nodes.length > 0) {
    const queue = [0]; // root is 0
    const visited = new Set([0]);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const children = edges.filter(e => e.fromNode === curr).map(e => e.toNode);
      for (const child of children) {
        if (!visited.has(child)) {
          visited.add(child);
          parentMap.set(child, curr);
          queue.push(child);
        }
      }
    }
  }

  function getDependencyPath(nodeId: number): string[] {
    const path: string[] = [];
    let curr: number | undefined = nodeId;
    while (curr !== undefined) {
      const node = nodes[curr];
      if (node) {
        path.unshift(`${node.versionKey.name}@${node.versionKey.version}`);
      }
      curr = parentMap.get(curr);
    }
    return path;
  }

  const allDeps = nodes.map((node, index) => ({ ...node, nodeId: index })).filter(n => n.relation !== 'SELF');
  const depInfos = await Promise.all(
    allDeps.map(async (dep) => {
      const [info, scorecard] = await Promise.all([
        getVersionInfo(ecosystem, dep.versionKey.name, dep.versionKey.version),
        getScorecard(ecosystem, dep.versionKey.name, dep.versionKey.version),
      ]);
      
      let depVulns: import('./types.js').OsvVuln[] = [];
      if (info?.advisoryKeys && info.advisoryKeys.length > 0 && policy.blockVulnerabilities) {
        depVulns = await queryVulnerabilities(ecosystem, dep.versionKey.name, dep.versionKey.version);
      }

      return { 
        dep, 
        licenses: info?.licenses ?? [], 
        scorecardScore: scorecard?.overallScore ?? null,
        depVulns
      };
    })
  );

  const depLicenses: DepLicense[] = [];
  const sbomViolations: Violation[] = [];

  for (const { dep, licenses: depLicList, scorecardScore, depVulns } of depInfos) {
    const flagged = depLicList.filter(l => policy.blockedLicenses.includes(l));
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

    const critHighVulns = depVulns.filter(v => v.severity === 'CRITICAL' || v.severity === 'HIGH' || v.severity === 'MEDIUM');
    if (critHighVulns.length > 0) {
      sbomViolations.push({
        type: 'SBOM_VULNERABILITY',
        severity: 'HIGH',
        reason: 'Transitive Dependency Vulnerability Detected',
        details: critHighVulns.map(v => `${v.aliases.find(a => a.startsWith('CVE-')) ?? v.id} (${v.severity})`),
        riskExplanation: `Transitive dependency ${dep.versionKey.name} contains ${critHighVulns.length} medium/high severity vulnerabilities. While not directly imported, the vulnerability may be exploitable via the dependency chain.`,
        affectedDep: `${dep.versionKey.name}@${dep.versionKey.version}`,
        path,
        fixedVersions: critHighVulns.flatMap(v => v.fixedVersions)
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
    documentation: { shortDescription: c.documentation.shortDescription },
  }));

  // ── Build violations ──────────────────────────────────────────────────────
  const violations: Violation[] = [...sbomViolations];
  const advisoryCount = vulnerabilities.length;

  // Root license violation
  const rootFlaggedLicenses = licenses.filter(l => policy.blockedLicenses.includes(l));
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
  const critHighVulns = vulnerabilities.filter(
    v => v.severity === 'CRITICAL' || v.severity === 'HIGH' || v.severity === 'MEDIUM'
  );
  if (critHighVulns.length > 0 && policy.blockVulnerabilities) {
    violations.push({
      type: 'VULNERABILITY',
      severity: 'HIGH',
      reason: 'Known Medium/High Severity Vulnerability Detected',
      details: critHighVulns.map(v => {
        const cve = v.aliases.find(a => a.startsWith('CVE-')) ?? v.id;
        return `${cve} (${v.severity}${v.cvssScore !== null ? ` · CVSS ${v.cvssScore.toFixed(1)}` : ''})`;
      }),
      riskExplanation: `This package version contains ${critHighVulns.length} known medium/high severity vulnerabilities. Attackers can exploit these flaws, violating baseline security compliance.`,
      fixedVersions: critHighVulns.flatMap(v => v.fixedVersions)
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
      reason: 'OpenSSF 高權重安全指標得分為 0（建議關注）',
      details: highSeverityZeroChecks.map(c => `${c.name}: 0/10`),
      riskExplanation: `以下高嚴重度 Scorecard 指標得分為零：${highSeverityZeroChecks.map(c => c.name).join(', ')}。雖然目前政策不強制阻擋，但這代表潛在的供應鏈安全缺陷，建議作為選用套件時的參考。`,
    });
  }

  // ── Lookup alternatives from policy ──────────────────────────────────────
  const alternatives: Alternative[] = [];
  const altDefs = policy.alternatives[packageName] ?? [];
  // Fetch alternatives in parallel
  await Promise.all(
    altDefs.map(async (alt) => {
      const altInfo = await getVersionInfo(ecosystem, alt.name);
      if (altInfo) {
        const altVulns = await queryVulnerabilities(ecosystem, alt.name, altInfo.versionKey.version);
        alternatives.push({
          name: alt.name,
          version: altInfo.versionKey.version,
          licenses: altInfo.licenses ?? [],
          advisoryCount: altVulns.length,
          depsDevUrl: depsDevUrl(ecosystem, alt.name, altInfo.versionKey.version),
          reason: alt.reason,
          source: 'policy',
        });
      }
    })
  );

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
    alternatives,
    depsDevUrl: depsDevUrl(ecosystem, packageName, resolvedVersion),
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
