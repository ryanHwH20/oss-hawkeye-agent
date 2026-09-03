import type { PackageEvidence } from '../evidence/package-evidence.js';
import type {
  CheckResult,
  DepLicense,
  OsvVuln,
  Policy,
  ScorecardCheck,
  ScorecardOfficialSeverity,
  Verdict,
  Violation,
} from '../types.js';
import { buildParentMap, dependencyPath } from '../util/depgraph.js';
import { flaggedLicenses } from '../util/license.js';
import { meetsBlockingThreshold } from '../util/severity.js';

const SCORECARD_SEVERITY: Record<string, ScorecardOfficialSeverity> = {
  'Dangerous-Workflow': 'Critical',
  'Webhooks': 'Critical',
  'Binary-Artifacts': 'High',
  'Branch-Protection': 'High',
  'Code-Review': 'High',
  'Dependency-Update-Tool': 'High',
  'Maintained': 'High',
  'Signed-Releases': 'High',
  'Token-Permissions': 'High',
  'Vulnerabilities': 'High',
  'Fuzzing': 'Medium',
  'Packaging': 'Medium',
  'Pinned-Dependencies': 'Medium',
  'SAST': 'Medium',
  'SBOM': 'Medium',
  'Security-Policy': 'Medium',
  'CI-Tests': 'Low',
  'CII-Best-Practices': 'Low',
  'Contributors': 'Low',
  'License': 'Low',
};

function scorecardChecks(evidence: PackageEvidence): ScorecardCheck[] {
  return (evidence.scorecard.payload?.checks ?? []).map(check => ({
    name: check.name,
    score: check.score,
    officialSeverity: SCORECARD_SEVERITY[check.name] ?? 'Unknown',
    documentation: {
      shortDescription: check.documentation.shortDescription,
      url: check.documentation.url,
    },
  }));
}

function vulnerabilityLabel(vulnerability: OsvVuln): string {
  const id = vulnerability.aliases.find(alias => alias.startsWith('CVE-')) ?? vulnerability.id;
  return `${id} (${vulnerability.severity}${
    vulnerability.cvssScore !== null ? ` · CVSS ${vulnerability.cvssScore.toFixed(1)}` : ''
  })`;
}

/**
 * Apply organization policy to already-collected evidence. This is the Decision
 * Kernel: it performs no I/O and identical inputs produce equivalent outputs.
 */
export function evaluatePackage(evidence: PackageEvidence, policy: Policy): CheckResult {
  const { system, name, resolvedVersion = 'latest' } = evidence.subject;
  const versionInfo = evidence.metadata.payload;
  const licenses = versionInfo?.licenses ?? [];
  const graph = evidence.dependencyGraph.payload;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const directDependencies = nodes.filter(node => node.relation === 'DIRECT');
  const indirectDependencies = nodes.filter(node => node.relation === 'INDIRECT');
  const parents = buildParentMap(nodes.length, edges);
  const violations: Violation[] = [];
  const depLicenses: DepLicense[] = [];
  const unverified: string[] = [];

  if (evidence.metadata.status === 'unavailable') {
    unverified.push('Package metadata & licenses (deps.dev)');
  } else if (evidence.metadata.status === 'not_found') {
    unverified.push('Package not found on deps.dev (no metadata to audit)');
  }
  if (evidence.dependencyGraph.status === 'unavailable') {
    unverified.push('Dependency graph / SBOM (deps.dev)');
  }
  if (evidence.vulnerabilities.status === 'unavailable') {
    unverified.push('Vulnerabilities (OSV)');
  }
  if (evidence.scorecard.status === 'unavailable') {
    unverified.push('OpenSSF Scorecard (deps.dev)');
  }

  let unverifiedDependencies = 0;
  for (const dependency of evidence.dependencies) {
    const dependencyInfo = dependency.metadata.payload;
    const dependencyLicenses = dependencyInfo?.licenses ?? [];
    const dependencyScore = dependency.scorecard.payload?.overallScore ?? null;
    const path = dependencyPath(nodes, parents, dependency.nodeId);
    const flagged = flaggedLicenses(dependencyLicenses, policy.blockedLicenses);
    const vulnerabilities = dependency.vulnerabilities.payload;

    if (dependency.metadata.status === 'unavailable' || dependency.vulnerabilities.status === 'unavailable') {
      unverifiedDependencies++;
    }

    depLicenses.push({
      name: dependency.dependency.versionKey.name,
      version: dependency.dependency.versionKey.version,
      licenses: dependencyLicenses,
      flagged,
      relation: dependency.dependency.relation,
      scorecardScore: dependencyScore,
      path,
    });

    if (flagged.length > 0) {
      violations.push({
        type: 'SBOM_LICENSE',
        severity: 'MEDIUM',
        reason: 'Transitive Dependency License Blocked',
        details: flagged,
        riskExplanation: `Transitive dependency ${dependency.dependency.versionKey.name} uses restricted licenses (${flagged.join(', ')}). Copyleft viral clauses in deep dependencies may still enforce open-source requirements on proprietary products.`,
        affectedDep: `${dependency.dependency.versionKey.name}@${dependency.dependency.versionKey.version}`,
        path,
      });
    }

    const malware = vulnerabilities.filter(vulnerability => vulnerability.malicious);
    if (malware.length > 0) {
      violations.push({
        type: 'MALWARE',
        severity: 'HIGH',
        reason: 'Malicious Transitive Dependency',
        details: malware.map(vulnerability =>
          vulnerability.aliases.find(alias => /^MAL-/i.test(alias)) ?? vulnerability.id
        ),
        riskExplanation: `Transitive dependency ${dependency.dependency.versionKey.name}@${dependency.dependency.versionKey.version} is flagged as malicious by OSV. Do not install — malware in the dependency chain executes with your application's privileges.`,
        affectedDep: `${dependency.dependency.versionKey.name}@${dependency.dependency.versionKey.version}`,
        path,
      });
    }

    const blockingVulnerabilities = vulnerabilities.filter(vulnerability =>
      !vulnerability.malicious && meetsBlockingThreshold(vulnerability.severity, policy.minBlockingSeverity)
    );
    if (policy.blockVulnerabilities && blockingVulnerabilities.length > 0) {
      violations.push({
        type: 'SBOM_VULNERABILITY',
        severity: 'HIGH',
        reason: 'Transitive Dependency Vulnerability Detected',
        details: blockingVulnerabilities.map(vulnerabilityLabel),
        riskExplanation: `Transitive dependency ${dependency.dependency.versionKey.name} contains ${blockingVulnerabilities.length} vulnerabilities at or above the ${policy.minBlockingSeverity} threshold. While not directly imported, the vulnerability may be exploitable via the dependency chain.`,
        affectedDep: `${dependency.dependency.versionKey.name}@${dependency.dependency.versionKey.version}`,
        path,
        fixedVersions: blockingVulnerabilities.flatMap(vulnerability => vulnerability.fixedVersions),
      });
    }
  }

  if (unverifiedDependencies > 0) {
    unverified.push(`SBOM (${unverifiedDependencies} of ${evidence.dependencies.length} dependencies unverified)`);
  }

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

  const vulnerabilities = evidence.vulnerabilities.payload;
  const malware = vulnerabilities.filter(vulnerability => vulnerability.malicious);
  if (malware.length > 0) {
    violations.push({
      type: 'MALWARE',
      severity: 'HIGH',
      reason: 'Known Malicious Package',
      details: malware.map(vulnerability =>
        vulnerability.aliases.find(alias => /^MAL-/i.test(alias)) ?? vulnerability.id
      ),
      riskExplanation: `${name}@${resolvedVersion} is flagged as malicious by OSV (${malware.map(vulnerability => vulnerability.id).join(', ')}). Do not install. Malicious packages exfiltrate secrets, install backdoors, or run arbitrary code at install time.`,
    });
  }

  const blockingVulnerabilities = vulnerabilities.filter(vulnerability =>
    !vulnerability.malicious && meetsBlockingThreshold(vulnerability.severity, policy.minBlockingSeverity)
  );
  if (policy.blockVulnerabilities && blockingVulnerabilities.length > 0) {
    violations.push({
      type: 'VULNERABILITY',
      severity: 'HIGH',
      reason: `Known Vulnerability at or above ${policy.minBlockingSeverity} severity`,
      details: blockingVulnerabilities.map(vulnerabilityLabel),
      riskExplanation: `This package version contains ${blockingVulnerabilities.length} known vulnerabilities at or above the ${policy.minBlockingSeverity} blocking threshold. Attackers can exploit these flaws, violating baseline security compliance.`,
      fixedVersions: blockingVulnerabilities.flatMap(vulnerability => vulnerability.fixedVersions),
    });
  }

  const scorecard = evidence.scorecard.payload;
  const checks = scorecardChecks(evidence);
  if (scorecard && scorecard.overallScore < policy.minScorecardScore) {
    violations.push({
      type: 'SCORECARD',
      severity: 'LOW',
      reason: 'OpenSSF Scorecard Security Posture Below Threshold',
      details: [`${scorecard.overallScore.toFixed(1)}/10 (Minimum Threshold: ${policy.minScorecardScore}/10)`],
      riskExplanation: `The package has an OpenSSF Scorecard rating of ${scorecard.overallScore.toFixed(1)}, falling below the recommended threshold of ${policy.minScorecardScore}/10. This may indicate immature security practices; proceed with caution.`,
    });
  }

  const highSeverityZeroChecks = checks.filter(check =>
    check.officialSeverity === 'High' && check.score === 0
  );
  if (highSeverityZeroChecks.length > 0) {
    violations.push({
      type: 'SCORECARD',
      severity: 'LOW',
      reason: 'OpenSSF High-Severity Security Metrics scored 0 (Advisory)',
      details: highSeverityZeroChecks.map(check => `${check.name}: 0/10`),
      riskExplanation: `The following high-severity Scorecard metrics scored zero: ${highSeverityZeroChecks.map(check => check.name).join(', ')}. While not strictly blocked by current policy, this indicates potential supply chain security flaws and should be considered when adopting this package.`,
    });
  }

  if (policy.blockTyposquats !== false && evidence.typosquat.payload) {
    const match = evidence.typosquat.payload;
    const how = match.kind === 'separator' ? 'differs only in separators/case from' : 'is one character away from';
    violations.push({
      type: 'TYPOSQUAT',
      severity: 'HIGH',
      reason: 'Possible Typosquat / Malicious Package',
      details: [`Did you mean "${match.nearest}"?`],
      riskExplanation: `The package name "${name}" ${how} the popular package "${match.nearest}". Typosquatted names are a common malware-delivery vector. If "${match.nearest}" is what you intended, install that; if this package is genuinely intended, approve it via a documented exception.`,
      affectedDep: match.nearest,
    });
  }

  const hasBlockingViolation = violations.some(violation =>
    violation.severity === 'HIGH' || violation.severity === 'MEDIUM'
  );
  const criticalEvidenceUnavailable =
    evidence.metadata.status === 'not_found' ||
    evidence.metadata.status === 'unavailable' ||
    evidence.dependencyGraph.status === 'unavailable' ||
    evidence.vulnerabilities.status === 'unavailable' ||
    unverifiedDependencies > 0;
  const verdict: Verdict = hasBlockingViolation
    ? 'BLOCKED'
    : criticalEvidenceUnavailable
      ? 'UNKNOWN'
      : 'SAFE';

  return {
    name,
    version: resolvedVersion,
    system,
    licenses,
    rootFlaggedLicenses,
    advisoryCount: vulnerabilities.length,
    vulnerabilities,
    osvScannerUsed: false,
    scorecardScore: scorecard?.overallScore ?? null,
    scorecardDate: scorecard?.date ?? null,
    scorecardChecks: checks,
    depCount: { direct: directDependencies.length, indirect: indirectDependencies.length },
    depLicenses,
    violations,
    verdict,
    unverified,
    depsDevUrl: evidence.links.depsDev,
    osvQueryUrl: evidence.links.osv,
    scorecardSourceUrl: evidence.links.scorecard,
  };
}
