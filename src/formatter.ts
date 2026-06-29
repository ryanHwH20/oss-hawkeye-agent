import type { CheckResult, OsvVuln, ScorecardOfficialSeverity } from './types.js';
import type { ScanReport } from './scan/scan.js';
import { loadPolicy } from './policy.js';

const policy = loadPolicy();

// ─── Exported header (used by server.ts for error/batch frames) ───────────────

export function hawkeyeHeader(): string {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
  return `**Hawkeye Agent** · \`${ts} UTC\`\n\n`;
}

// ─── Score / Status Helpers ───────────────────────────────────────────────────

function scoreLight(score: number): string {
  if (score < 0) return '—';
  if (score >= 7) return `🟢 ${score}/10`;
  if (score >= 4) return `🟡 ${score}/10`;
  return `🔴 ${score}/10`;
}

function severityLabel(s: OsvVuln['severity']): string {
  switch (s) {
    case 'CRITICAL': return '🔴 Critical';
    case 'HIGH':     return '🔴 High';
    case 'MEDIUM':   return '🟡 Medium';
    case 'LOW':      return '🔵 Low';
    default:         return 'Unknown';
  }
}

function officialSev(s: ScorecardOfficialSeverity): string {
  switch (s) {
    case 'Critical': return '🔴 Critical';
    case 'High':   return '🔴 High';
    case 'Medium': return '🟡 Medium';
    case 'Low':    return '🟢 Low';
    default:       return '—';
  }
}

// ─── Section: Verdict Banner ──────────────────────────────────────────────────

function verdictBanner(r: CheckResult): string[] {
  const hasAdvisory = r.violations.some(v => v.severity === 'LOW');

  const verdict = r.verdict === 'BLOCKED'
    ? '❌  BLOCKED — Security Policy Violation'
    : r.verdict === 'UNKNOWN'
      ? '⚠️  UNVERIFIED — Audit Could Not Be Completed'
      : hasAdvisory
        ? '✅  APPROVED — With Advisories'
        : '✅  APPROVED — Fully Compliant';

  const today = new Date().toLocaleDateString('en-US');

  return [
    `# Package Audit: \`${r.name}@${r.version}\` (${r.system})`,
    '',
    `> ### ${verdict}`,
    '',
    `Policy: **${policy.organizationName} · Security Baseline** | Date: \`${today}\``,
    '',
    '---',
    '',
  ];
}

// ─── Section: Unverified Sources (fail-closed disclosure) ─────────────────────

function unverifiedBanner(r: CheckResult): string[] {
  if (r.unverified.length === 0) return [];

  return [
    '> [!CAUTION]',
    '> **Incomplete Audit — Failing Closed.** The following data sources could not be reached, so this package could **not** be fully verified:',
    '>',
    ...r.unverified.map(u => `> - ${u}`),
    '>',
    '> A security guardrail does not treat an unverifiable package as safe. Re-run once the sources are reachable, or proceed only with explicit, documented risk acceptance.',
    '',
    '---',
    '',
  ];
}

// ─── Section: Version Warning ───────────────────────────────────────────────────

function versionWarning(r: CheckResult): string[] {
  const preReleaseRegex = /[.-](alpha|beta|rc|m\d+|milestone|dev|snapshot|preview|next)(?:\d+)?$/i;
  const match = r.version.match(preReleaseRegex);
  if (!match) return [];

  const type = match[1].toUpperCase();
  return [
    `> [!WARNING]`,
    `> **Pre-release Version:** The requested version \`${r.version}\` is a ${type} pre-release. It is highly recommended to use a stable GA release for production environments.`,
    '',
  ];
}

// ─── Section: Quick Reference (TL;DR Table) ───────────────────────────────────

function quickReference(r: CheckResult): string[] {
  const hasBlock = r.violations.some(v => v.severity === 'HIGH' || v.severity === 'MEDIUM');

  // Which sources were unreachable — used to avoid claiming "clean" when we
  // simply could not look.
  const licenseUnverified = r.unverified.some(u => u.startsWith('Package metadata'));
  const vulnUnverified = r.unverified.some(u => u.startsWith('Vulnerabilities'));
  const scorecardUnverified = r.unverified.some(u => u.startsWith('OpenSSF'));

  const licStatus = r.rootFlaggedLicenses.length > 0
    ? `❌ Blocked (\`${r.rootFlaggedLicenses.join(', ')}\`)`
    : licenseUnverified
      ? '⚪ Unverified — source unreachable'
      : `✅ \`${r.licenses.join(', ') || 'Unknown'}\` — Compliant`;

  const vulnStatus = vulnUnverified
    ? '⚪ Unverified — OSV unreachable'
    : r.vulnerabilities.length === 0
      ? '✅ No Known Vulnerabilities'
      : `❌ ${r.vulnerabilities.length} Vulns (${r.vulnerabilities.filter(v => v.severity === 'CRITICAL' || v.severity === 'HIGH').length} High/Critical)`;

  const scoreNum = r.scorecardScore;
  const scoreStatus = scoreNum === null
    ? (scorecardUnverified ? '⚪ Unverified — source unreachable' : '⚪ N/A')
    : scoreNum >= 7
      ? `🟢 ${scoreNum.toFixed(1)}/10`
      : scoreNum >= 4
        ? `🟡 ${scoreNum.toFixed(1)}/10 — Advisory`
        : `🔴 ${scoreNum.toFixed(1)}/10 — Below Threshold`;

  const policyStatus = hasBlock
    ? `❌ ${r.violations.filter(v => v.severity === 'HIGH').length} Blocking Issues`
    : r.verdict === 'UNKNOWN'
      ? '⚠️ Unverified — failing closed'
      : r.violations.filter(v => v.severity === 'LOW').length > 0
        ? `⚠️ ${r.violations.filter(v => v.severity === 'LOW').length} Advisories`
        : '✅ Compliant';

  return [
    '## Quick Reference',
    '',
    '| Category | Status |',
    '| :--- | :--- |',
    `| 📜 License | ${licStatus} |`,
    `| 🐛 Vulnerabilities | ${vulnStatus} |`,
    `| 📊 OpenSSF Scorecard | ${scoreStatus} |`,
    `| 🏛️ Policy | ${policyStatus} |`,
    '',
    '---',
    '',
  ];
}

// ─── Section: Findings & Actions (Core User Guide) ───────────────────────────────

function findingsAndActions(r: CheckResult): string[] {
  const blocking = r.violations.filter(v => v.severity === 'HIGH' || v.severity === 'MEDIUM');
  const advisory = r.violations.filter(v => v.severity === 'LOW');

  if (blocking.length === 0 && advisory.length === 0) {
    return [
      '## 🚨 Blocking Issues & Remediation',
      '',
      '✅ All checks passed. No actions required.',
      '',
      '---',
      '',
    ];
  }

  const lines: string[] = [
    '## 🚨 Blocking Issues & Remediation',
    '',
  ];

  // ── Blocking Findings ──
  if (blocking.length > 0) {
    lines.push('### ⛔ Blocking Issues — Action Required');
    lines.push('');
    lines.push('> The following issues prevent this package from being used. Do not install until resolved or an exception is approved by the Security Team.');
    lines.push('');

    for (const v of blocking) {
      const icon = v.severity === 'HIGH' ? '🔴' : '🟡';
      lines.push(`#### ${icon} ${v.reason}`);
      lines.push('');
      if (v.details.length > 0) {
        lines.push(`**Affected:** \`${v.details.join('`, `')}\``);
        lines.push('');
      }
      lines.push(`**Risk:** ${v.riskExplanation}`);
      lines.push('');
      
      if (v.path && v.path.length > 0) {
        lines.push(`**Dependency Topology Path:**`);
        lines.push(`\`${r.name}@${r.version}\` ➡️ \`${v.path.join('` ➡️ `')}\``);
        lines.push('');
      }

      // Contextual action for this specific violation
      if (v.type === 'LICENSE') {
        lines.push('**Remediation Strategy:**');
        lines.push('1. Ask your AI assistant to suggest a compliant alternative package.');
        lines.push(`2. Or [Submit an Exception Request](${policy.exceptionFormUrl}) to justify business needs.`);
        lines.push('3. Notify the Legal and Security teams to assess license conflict scope.');
      } else if (v.type === 'VULNERABILITY') {
        const fixableVulns = r.vulnerabilities.filter(x => x.fixedVersions.length > 0);
        const fixVersions = [...new Set(fixableVulns.flatMap(x => x.fixedVersions))].slice(0, 3);
        lines.push('**Remediation Strategy:**');
        if (fixVersions.length > 0) {
          lines.push(`1. Upgrade to a patched version: ${fixVersions.map(v => `\`${v}\``).join(', ')}`);
          lines.push('2. Update your manifest and reinstall dependencies.');
        } else {
          lines.push(`1. [Submit an Exception Request](${policy.exceptionFormUrl}) and commit to upgrading within 30 days of a patch release.`);
          lines.push('2. Ask your AI assistant to suggest a secure alternative package.');
        }
      } else {
        lines.push('**Remediation Strategy:**');
        lines.push(`1. [Submit an Exception Request](${policy.exceptionFormUrl})`);
        lines.push('2. Contact the Security team to discuss the use case.');
      }
      lines.push('');
    }
  }

  // ── Advisory Findings ──
  if (advisory.length > 0) {
    lines.push('### 💡 Advisory — Recommendations (Non-Blocking)');
    lines.push('');
    for (const v of advisory) {
      lines.push(`#### 🔵 ${v.reason}`);
      lines.push('');
      if (v.details.length > 0) {
        lines.push(`**Note:** \`${v.details.join('`, `')}\``);
        lines.push('');
      }
      lines.push(`**Explanation:** ${v.riskExplanation}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');

  return lines;
}

// ─── Section: License ─────────────────────────────────────────────────────────

function licenseSection(r: CheckResult): string[] {
  const declared = r.licenses.length > 0 ? r.licenses.join(', ') : 'Unknown';
  const status = r.rootFlaggedLicenses.length > 0
    ? `❌ \`${r.rootFlaggedLicenses.join(', ')}\` — Policy Violation`
    : `✅ \`${declared}\` — Approved`;

  const lines = [
    '## 📜 License',
    `_Source: [deps.dev package metadata](${r.depsDevUrl})_`,
    '',
    `* **Declared:** \`${declared}\``,
    `* **Status:** ${status}`,
    '',
  ];

  if (r.rootFlaggedLicenses.length === 0) {
    lines.push('No viral copyleft risks detected. Safe for proprietary commercial use.');
  }
  lines.push('');

  return lines;
}

// ─── Section: Vulnerabilities ────────────────────────────────────────────────

function vulnerabilitySection(r: CheckResult): string[] {
  const lines: string[] = [
    '## 🐛 Vulnerabilities',
    `_Source: [OSV package query](${r.osvQueryUrl})_`,
    '',
  ];

  // Never present "no vulnerabilities" when OSV could not actually be queried.
  if (r.unverified.some(u => u.startsWith('Vulnerabilities'))) {
    lines.push('> [!CAUTION]');
    lines.push('> **Could not verify.** OSV was unreachable (network error, rate limit, or outage), so the vulnerability status of this version is **unknown** — not confirmed clean.');
    lines.push('');
    return lines;
  }

  if (r.vulnerabilities.length === 0) {
    lines.push('✅ No known vulnerabilities detected for this version.');
    lines.push('');
    return lines;
  }

  for (const v of r.vulnerabilities) {
    const cve = v.aliases.find(a => a.startsWith('CVE-'));
    const ghsa = v.aliases.find(a => a.startsWith('GHSA-'));
    const titleId = cve ?? ghsa ?? v.id;
    const altId = (cve && ghsa) ? ` · \`${ghsa}\`` : '';
    const fixedStr = v.fixedVersions.length > 0
      ? v.fixedVersions.map(f => `\`${f}\``).join(', ')
      : '⚠️ No patch available';
    const cvssStr = v.cvssScore !== null
      ? `${severityLabel(v.severity)} · CVSS ${v.cvssScore.toFixed(1)}`
      : severityLabel(v.severity);

    lines.push(`* **\`${titleId}\`**${altId}`);
    lines.push(`  * Severity: ${cvssStr}`);
    lines.push(`  * Fix: ${fixedStr}`);
    lines.push(`  * Summary: ${v.summary}`);
    lines.push(`  * Ref: [osv.dev/vulnerability/${v.id}](https://osv.dev/vulnerability/${v.id})`);
    lines.push('');
  }

  return lines;
}

// ─── Section: OpenSSF Scorecard ───────────────────────────────────────────────

function scorecardSection(r: CheckResult): string[] {
  const scoreStr = r.scorecardScore !== null ? `${scoreLight(r.scorecardScore)}` : '⚪ N/A';
  const scorecardSource = r.scorecardSourceUrl
    ? `[deps.dev project scorecard API](${r.scorecardSourceUrl})`
    : `[deps.dev package page](${r.depsDevUrl})`;

  const lines: string[] = [
    `## 📊 OpenSSF Scorecard (${scoreStr})`,
    `_Source: ${scorecardSource}_`,
    '',
  ];

  if (r.scorecardChecks.length === 0) {
    lines.push('ℹ️ This package is not tracked by OpenSSF Scorecard (likely not hosted on GitHub).');
    lines.push('');
    return lines;
  }

  lines.push('### Detailed Scorecard Metrics');
  lines.push('');
  lines.push('> 💡 **Ecosystem Context:**');
  lines.push('> Large projects (e.g. Spring Boot, React) may score 0 in metrics like `Code-Review` if they use custom CI/CD or internal workflows instead of GitHub branch protections. This is common for enterprise repositories and can often be safely ignored.');
  lines.push('');
  lines.push('| Metric | Severity | Score | Reference |');
  lines.push('| :--- | :--- | :--- | :--- |');

  const sevWeight = (s: string) => {
    switch (s) {
      case 'Critical': return 4;
      case 'High':     return 3;
      case 'Medium':   return 2;
      case 'Low':      return 1;
      default:         return 0;
    }
  };

  const sortedChecks = [...r.scorecardChecks].sort((a, b) => {
    return sevWeight(b.officialSeverity) - sevWeight(a.officialSeverity);
  });

  for (const c of sortedChecks) {
    const score = c.score < 0 ? '—' : `${scoreLight(c.score)}`;
    const ref = c.documentation.url ? `[Doc](${c.documentation.url})` : '—';
    lines.push(`| ${c.name} | ${officialSev(c.officialSeverity)} | ${score} | ${ref} |`);
  }
  lines.push('');
  lines.push('');

  return lines;
}

// ─── Section: SBOM ───────────────────────────────────────────────────────────

function sbomSection(r: CheckResult): string[] {
  const total = 1 + r.depLicenses.length;
  const flaggedCount = r.depLicenses.filter(d => d.flagged.length > 0).length;
  const isAllClean = flaggedCount === 0 && r.vulnerabilities.length === 0;

  const lines: string[] = [
    `## 📦 SBOM — ${total} Dependencies`,
    `_Source: [deps.dev dependency graph](${r.depsDevUrl})_`,
    '',
  ];

  if (isAllClean) {
    lines.push(`✅ **SBOM Clean:** All ${total} dependencies are compliant and free of known vulnerabilities.`);
    lines.push('');
  } else {
    lines.push(`❌ **SBOM Violation:** Contains known vulnerabilities or restricted licenses.`);
    lines.push('');
    if (flaggedCount > 0) {
      lines.push(`> [!CAUTION]`);
      lines.push(`> **Risk Alert:** ${flaggedCount} dependencies contain restricted licenses (e.g., GPL) and have been highlighted below. For indirect dependencies, try upgrading the root package or use \`resolutions\` / \`overrides\` to force a compliant version.`);
      lines.push('');
    }
  }

  lines.push('| Component | Version | Scope | License | Scorecard | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

  const rootLic = r.licenses.length > 0 ? r.licenses.join(', ') : 'Unknown';
  const rootStatus = r.vulnerabilities.length === 0 ? '✅' : `❌ ${r.vulnerabilities.length} vuln`;
  const rootScore = r.scorecardScore !== null ? scoreLight(r.scorecardScore) : '⚪';
  lines.push(`| [**${r.name}**](${r.depsDevUrl}) | \`${r.version}\` | Direct | \`${rootLic}\` | ${rootScore} | ${rootStatus} |`);

  const sortedDeps = [...r.depLicenses].sort((a, b) => {
    // 1. Sort by Status (blocked licenses first)
    if (a.flagged.length > 0 && b.flagged.length === 0) return -1;
    if (a.flagged.length === 0 && b.flagged.length > 0) return 1;

    // 2. Sort by Scorecard Score (lowest score first, which is highest risk)
    const scoreA = a.scorecardScore !== null && a.scorecardScore !== undefined ? a.scorecardScore : 100;
    const scoreB = b.scorecardScore !== null && b.scorecardScore !== undefined ? b.scorecardScore : 100;
    return scoreA - scoreB;
  });

  for (const dep of sortedDeps) {
    const lic = dep.licenses.length > 0 ? dep.licenses.join(', ') : 'Unknown';
    const scope = dep.relation === 'DIRECT' ? 'Direct' : 'Indirect';
    const depUrl = `https://deps.dev/${r.system.toLowerCase()}/${encodeURIComponent(dep.name)}/${encodeURIComponent(dep.version)}`;
    const depStatus = dep.flagged.length > 0 ? `❌ ${dep.flagged.join(', ')}` : '✅';
    const depScore = dep.scorecardScore !== null && dep.scorecardScore !== undefined ? scoreLight(dep.scorecardScore) : '⚪';
    lines.push(`| [${dep.name}](${depUrl}) | \`${dep.version}\` | ${scope} | \`${lic}\` | ${depScore} | ${depStatus} |`);
  }

  lines.push('');
  lines.push('');
  
  return lines;
}

// ─── Section: Actionable Snippet ──────────────────────────────────────────────

// findSmartUpgrades now lives in util/remediation.ts (shared with the install
// guardrail's machine-actionable output). Imported for internal use here and
// re-exported for existing callers (e.g. test/upgrades.test.ts).
import { findSmartUpgrades } from './util/remediation.js';
export { findSmartUpgrades };

function actionableBlock(r: CheckResult): string[] {
  const lines: string[] = [
    '## 🚀 Automated Remediation',
    '',
  ];

  const hasBlocking = r.violations.some(v => v.severity === 'HIGH' || v.severity === 'MEDIUM');
  
  let targetName = r.name;
  let targetVersion = r.version;
  let message = `You can directly copy the following snippet to import \`${r.name}\` into your project:`;
  let isIndirectVuln = false;
  let indirectOverrides: Array<{ name: string; version: string; minimal: string | null; latest: string | null }> = [];

  if (hasBlocking) {
    const vulnViolations = r.violations.filter(v => v.type === 'VULNERABILITY');
    const sbomVulnViolations = r.violations.filter(v => v.type === 'SBOM_VULNERABILITY');
    const licenseViolations = r.violations.filter(v => v.type === 'LICENSE' || v.type === 'SBOM_LICENSE');
    
    let safeVersionFound = false;

      // Scenario 1 & 2: Direct package vulnerability handling
    if (vulnViolations.length > 0) {
      const allFixed = r.vulnerabilities.flatMap(v => v.fixedVersions);
      const upgrades = findSmartUpgrades(r.version, allFixed);
      
      if (upgrades.minimal) {
        targetVersion = upgrades.minimal; 
        safeVersionFound = true;
        const upgradeStr = upgrades.minimal === upgrades.latest ? `\`${upgrades.minimal}\`` : `\`${upgrades.minimal}\` (No Breaking Changes) or Latest Stable \`${upgrades.latest}\``;
        message = `> ❌ **BLOCKED (Direct Vulnerability)** — The requested version contains high-risk vulnerabilities.\n> \n> **💡 AI Guidance:** Official patches are available. Upgrade to ${upgradeStr}:`;
      } else {
        return [
          '## 🚀 Automated Remediation',
          '',
          `> ❌ **BLOCKED (Unpatched Vulnerability)** — There is currently **no official patch** available for this package!`,
          `> `,
          `> **💡 Remediation:**`,
          `> 1. **Replace Package (Recommended)**: Ask your AI assistant to suggest a secure alternative.`,
          `> 2. **Manual Fix**: If you must use this package, consider creating a manual patch or contributing a PR to the upstream repository.`,
          ''
        ];
      }
    } 
    // Scenario 3: Shadow dependency vulnerability handling (Overrides)
    else if (sbomVulnViolations.length > 0) {
      isIndirectVuln = true;
      message = `> ❌ **BLOCKED (Transitive Vulnerability)** — The root package is safe, but vulnerabilities exist deep within the dependency chain.\n> \n> **💡 AI Guidance:** Copy the following \`overrides\` / \`resolutions\` block into your \`package.json\` to force a secure underlying dependency version:`;
      
      for (const sbom of sbomVulnViolations) {
        const [depName, depVer] = (sbom.affectedDep ?? '').split('@');
        const fixed = sbom.fixedVersions ?? [];
        const upgrades = findSmartUpgrades(depVer, fixed);
        if (upgrades.minimal) {
          indirectOverrides.push({ name: depName, version: depVer, minimal: upgrades.minimal, latest: upgrades.latest });
        }
      }
    }
    // Scenario 4: License issues
    else if (licenseViolations.length > 0) {
      return [
        '## 🚀 Automated Remediation',
        '',
        `> ❌ **BLOCKED (License Conflict)** — This package violates corporate licensing policy.`,
        `> `,
        `> **💡 Remediation:**`,
        `> License issues cannot be patched by upgrading. Ask your AI assistant to suggest a compliant alternative (e.g., MIT/Apache-2.0).`,
        ''
      ];
    }
  }

  lines.push(message);
  lines.push('');

  const sys = r.system.toUpperCase();
  
  if (isIndirectVuln && sys === 'NPM') {
    lines.push('```json');
    lines.push('// Add this to your package.json');
    lines.push('"overrides": {');
    for (let i = 0; i < indirectOverrides.length; i++) {
      const ov = indirectOverrides[i];
      lines.push(`  "${ov.name}": "^${ov.minimal}"${i < indirectOverrides.length - 1 ? ',' : ''}`);
    }
    lines.push('}');
    lines.push('```');
    return lines;
  }

  let snippet = '';
  if (sys === 'NPM') {
    snippet = `npm install ${targetName}@${targetVersion}`;
  } else if (sys === 'MAVEN') {
    const parts = targetName.split(':');
    const groupId = parts[0];
    const artifactId = parts[1] || parts[0];
    snippet = `<dependency>\n    <groupId>${groupId}</groupId>\n    <artifactId>${artifactId}</artifactId>\n    <version>${targetVersion}</version>\n</dependency>`;
  } else if (sys === 'PYPI') {
    snippet = `pip install ${targetName}==${targetVersion}`;
  } else if (sys === 'GO') {
    snippet = `go get ${targetName}@v${targetVersion.replace(/^v/, '')}`;
  } else {
    snippet = `${targetName} ${targetVersion}`;
  }

  const lang = sys === 'MAVEN' ? 'xml' : 'bash';

  lines.push(`\`\`\`${lang}`);
  lines.push(snippet);
  lines.push(`\`\`\``);
  lines.push('');

  return lines;
}

// ─── Main Format Function ─────────────────────────────────────────────────────

export function formatResult(r: CheckResult): string {
  return [
    ...verdictBanner(r),
    ...unverifiedBanner(r),
    ...versionWarning(r),
    ...quickReference(r),
    ...findingsAndActions(r),
    ...licenseSection(r),
    ...vulnerabilitySection(r),
    ...scorecardSection(r),
    ...sbomSection(r),
    ...actionableBlock(r),
  ].join('\n');
}

// ─── Batch Command Verdict ────────────────────────────────────────────────────

export function formatCommandVerdict(results: CheckResult[]): string {
  const failCount = results.filter(r => r.verdict === 'BLOCKED').length;
  const unknownCount = results.filter(r => r.verdict === 'UNKNOWN').length;
  const warnCount = results.filter(r =>
    r.verdict === 'SAFE' && r.violations.some(v => v.severity === 'LOW')
  ).length;
  const passCount = results.length - failCount - unknownCount - warnCount;

  const overall = failCount > 0
    ? `> ❌ **${failCount} Packages Blocked** — You must submit an exception request and gain Security Team approval before installation.`
    : unknownCount > 0
      ? `> ⚠️ **${unknownCount} Packages Unverified** — data sources were unreachable. Failing closed: do not install until they can be audited.`
      : warnCount > 0
        ? `> ⚠️ **All packages approved for installation**, but ${warnCount} packages have advisories.`
        : `> ✅ **All ${results.length} packages successfully passed the audit.**`;

  return [
    '## Batch Audit Summary',
    '',
    '| Status | Count |',
    '| :--- | ---: |',
    `| Total Packages | ${results.length} |`,
    `| ✅ Passed | ${passCount} |`,
    `| ⚠️ Advisory | ${warnCount} |`,
    `| ⚪ Unverified | ${unknownCount} |`,
    `| ❌ Blocked | ${failCount} |`,
    '',
    overall,
  ].join('\n');
}

// ─── Project Scan Report ──────────────────────────────────────────────────────

export function formatScanReport(report: ScanReport): string {
  const r = report.results;
  const badge = report.verdict === 'BLOCKED'
    ? '❌  BLOCKED'
    : report.verdict === 'UNKNOWN'
      ? '⚠️  UNVERIFIED'
      : '✅  APPROVED';

  const manifests = report.manifests.map(m => `\`${m}\``).join(', ') || '_none found_';
  const lines: string[] = [
    `# 🎾 Project Scan — ${badge}`,
    '',
    `**Path:** \`${report.path}\` · **Manifests:** ${manifests} · **Dependencies audited:** ${r.length}`,
    '',
  ];

  if (r.length === 0) {
    lines.push('No supported manifests with dependencies were found (looked for `package.json`, `requirements.txt`).');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(formatCommandVerdict(r), '');

  const blocked = r.filter(x => x.verdict === 'BLOCKED');
  if (blocked.length > 0) {
    lines.push('## ❌ Blocked');
    for (const x of blocked) {
      const reason = x.violations.find(v => v.severity !== 'LOW')?.reason ?? 'Policy violation';
      lines.push(`- \`${x.name}@${x.version}\` (${x.system}) — ${reason}`);
    }
    lines.push('');
  }

  const unknown = r.filter(x => x.verdict === 'UNKNOWN');
  if (unknown.length > 0) {
    lines.push('## ⚠️ Unverified (failing closed)');
    for (const x of unknown) {
      lines.push(`- \`${x.name}@${x.version}\` (${x.system}) — could not verify ${x.unverified.join(', ')}`);
    }
    lines.push('');
  }

  if (report.weakIntegrity.length > 0) {
    lines.push('## 🔓 Weak integrity (advisory)');
    lines.push('These lockfile entries have no integrity hash, so npm will not verify the installed bytes:');
    for (const n of report.weakIntegrity) lines.push(`- \`${n}\``);
    lines.push('');
  }

  return lines.join('\n');
}

/** Hidden marker so the PR bot can find and update its own comment in place. */
export const PR_COMMENT_MARKER = '<!-- hawkeye-pr-comment -->';

/**
 * Render a concise, sticky PR comment for a project scan. Leads with the marker
 * so a bot can update the same comment on each push instead of stacking new
 * ones, and collapses the detail tables to keep the thread readable.
 */
export function formatScanComment(report: ScanReport): string {
  const r = report.results;
  const blocked = r.filter(x => x.verdict === 'BLOCKED');
  const unknown = r.filter(x => x.verdict === 'UNKNOWN');
  const passed = r.length - blocked.length - unknown.length;

  const badge = report.verdict === 'BLOCKED' ? '❌ Blocked'
    : report.verdict === 'UNKNOWN' ? '⚠️ Unverified'
      : '✅ Passed';
  const manifests = report.manifests.map(m => `\`${m}\``).join(', ') || '_none found_';

  const lines: string[] = [
    PR_COMMENT_MARKER,
    `## 🎾 Hawkeye — Supply-Chain Scan: ${badge}`,
    '',
    `**${r.length}** dependencies · ${manifests} · ✅ ${passed} passed · ⚠️ ${unknown.length} unverified · ❌ ${blocked.length} blocked`,
    '',
  ];

  if (blocked.length > 0) {
    lines.push(`<details open><summary><strong>❌ Blocked (${blocked.length})</strong></summary>`, '',
      '| Package | Ecosystem | Reason |', '| :-- | :-- | :-- |');
    for (const x of blocked) {
      const reason = x.violations.find(v => v.severity !== 'LOW')?.reason ?? 'Policy violation';
      lines.push(`| \`${x.name}@${x.version}\` | ${x.system} | ${reason} |`);
    }
    lines.push('', '</details>', '');
  }

  if (unknown.length > 0) {
    lines.push(`<details><summary><strong>⚠️ Unverified — failing closed (${unknown.length})</strong></summary>`, '',
      '| Package | Ecosystem | Could not verify |', '| :-- | :-- | :-- |');
    for (const x of unknown) {
      lines.push(`| \`${x.name}@${x.version}\` | ${x.system} | ${x.unverified.join('; ')} |`);
    }
    lines.push('', '</details>', '');
  }

  if (blocked.length === 0 && unknown.length === 0) {
    lines.push('> ✅ All dependencies passed Hawkeye’s supply-chain checks — license, CVE/CVSS, OpenSSF Scorecard, transitive SBOM, and typosquat.', '');
  }

  if (report.weakIntegrity.length > 0) {
    lines.push(`<details><summary><strong>🔓 Weak integrity — no hash (${report.weakIntegrity.length})</strong></summary>`, '',
      'npm will not verify the installed bytes for these lockfile entries:', '');
    for (const n of report.weakIntegrity) lines.push(`- \`${n}\``);
    lines.push('', '</details>', '');
  }

  lines.push('---',
    '<sub>🎾 Hawkeye fails closed: an unverifiable dependency is never reported as safe. · [Hawkeye Agent](https://github.com/ryanHwH20/oss-hawkeye-agent)</sub>');
  return lines.join('\n');
}
