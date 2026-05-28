import type { CheckResult, Policy, DepLicense, Violation, Alternative } from './types.js';
import { getVersionInfo, getDependencies, getScorecard, depsDevUrl } from './api/deps-dev.js';
import { queryVulnerabilities } from './api/osv.js';

/**
 * Check a single package against policy
 */
export async function checkPackage(
  ecosystem: string,
  packageName: string,
  version: string | undefined,
  policy: Policy
): Promise<CheckResult> {
  // 1. Get version info from deps.dev
  const versionInfo = await getVersionInfo(ecosystem, packageName, version);
  const resolvedVersion = versionInfo?.versionKey?.version ?? version ?? 'latest';
  const licenses = versionInfo?.licenses ?? [];

  // 2. Get dependencies
  const depsData = await getDependencies(ecosystem, packageName, resolvedVersion);
  const nodes = depsData?.nodes ?? [];
  const selfNode = nodes.find(n => n.relation === 'SELF');
  const directDeps = nodes.filter(n => n.relation === 'DIRECT');
  const indirectDeps = nodes.filter(n => n.relation === 'INDIRECT');

  // 3. Build dep license list
  const depLicenses: DepLicense[] = [];
  for (const dep of [...directDeps, ...indirectDeps]) {
    const depLicList = dep.licenses ?? [];
    const flagged = depLicList.filter(l => policy.blockedLicenses.includes(l));
    depLicenses.push({
      name: dep.versionKey.name,
      version: dep.versionKey.version,
      licenses: depLicList,
      flagged,
      relation: dep.relation as 'DIRECT' | 'INDIRECT',
    });
  }

  // 4. Query vulnerabilities from OSV
  const vulnerabilities = await queryVulnerabilities(ecosystem, packageName, resolvedVersion);
  const advisoryCount = vulnerabilities.length;

  // 4.5 Get OpenSSF Scorecard
  const scorecardData = await getScorecard(ecosystem, packageName, resolvedVersion);
  const scorecardScore = scorecardData?.overallScore ?? null;
  const scorecardDate = scorecardData?.date ?? null;
  const scorecardChecks = (scorecardData?.checks ?? []).map(c => ({
    name: c.name,
    score: c.score,
    documentation: { shortDescription: c.documentation.shortDescription },
  }));

  // 5. Check root license against policy
  const rootFlaggedLicenses = licenses.filter(l => policy.blockedLicenses.includes(l));

  // 6. Build violations
  const violations: Violation[] = [];

  // License violation (root package)
  if (rootFlaggedLicenses.length > 0) {
    violations.push({
      type: 'LICENSE',
      severity: 'HIGH',
      reason: '套件授權條款在公司黑名單中',
      details: rootFlaggedLicenses,
      riskExplanation: `此授權（${rootFlaggedLicenses.join(', ')}）具有 Copyleft 或商業限制條款，引入後可能要求衍生作品開源或限制商業使用，對企業產品構成法律風險。`,
    });
  }

  // SBOM license violation (dependencies)
  const flaggedDeps = depLicenses.filter(d => d.flagged.length > 0);
  for (const dep of flaggedDeps) {
    violations.push({
      type: 'SBOM_LICENSE',
      severity: 'MEDIUM',
      reason: '依賴套件授權條款在公司黑名單中',
      details: dep.flagged,
      riskExplanation: `傳遞依賴 ${dep.name} 使用了受限授權（${dep.flagged.join(', ')}），即使主套件授權寬鬆，依賴的 Copyleft 授權仍可能對最終產品產生法律約束。`,
      affectedDep: `${dep.name}@${dep.version}`,
    });
  }

  // Vulnerability violation
  const critHighVulns = vulnerabilities.filter(
    v => v.severity === 'CRITICAL' || v.severity === 'HIGH' || v.severity === 'MEDIUM'
  );
  if (critHighVulns.length > 0 && policy.blockVulnerabilities) {
    violations.push({
      type: 'VULNERABILITY',
      severity: 'MEDIUM',
      reason: '存在已知中高風險漏洞',
      details: critHighVulns.map(v => {
        const cve = v.aliases.find(a => a.startsWith('CVE-')) ?? v.id;
        return `${cve} (${v.severity})`;
      }),
      riskExplanation: `此套件存在 ${critHighVulns.length} 個已知的中高風險漏洞，攻擊者可能利用這些漏洞對系統發動攻擊。`,
    });
  }

  // Scorecard violation
  if (scorecardScore !== null && scorecardScore < policy.minScorecardScore) {
    violations.push({
      type: 'SCORECARD',
      severity: 'MEDIUM',
      reason: 'OpenSSF Scorecard 低於公司門檻',
      details: [`${scorecardScore.toFixed(1)}/10（門檻：${policy.minScorecardScore}/10）`],
      riskExplanation: `此套件的 OpenSSF Scorecard 評分為 ${scorecardScore.toFixed(1)}，低於公司要求的最低門檻 ${policy.minScorecardScore}/10。低評分可能代表該專案在安全實踐（如程式碼審查、CI/CD、依賴管理等）上不夠成熟，存在供應鏈安全風險。`,
    });
  }

  // 7. Lookup alternatives from policy
  const alternatives: Alternative[] = [];
  const altDefs = policy.alternatives[packageName] ?? [];
  for (const alt of altDefs) {
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
  }

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
 * Check multiple packages
 */
export async function checkPackages(
  packages: Array<{ system: string; name: string; version: string }>,
  policy: Policy
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const pkg of packages) {
    const result = await checkPackage(pkg.system, pkg.name, pkg.version || undefined, policy);
    results.push(result);
  }
  return results;
}
