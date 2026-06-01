import type { CheckResult, OsvVuln, ScorecardOfficialSeverity } from './types.js';
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
  const hasBlock = r.violations.some(v => v.severity === 'HIGH' || v.severity === 'MEDIUM');
  const hasAdvisory = r.violations.some(v => v.severity === 'LOW');

  const verdict = hasBlock
    ? '❌  BLOCKED — Security Policy Violation'
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

  const licStatus = r.rootFlaggedLicenses.length > 0
    ? `❌ Blocked (\`${r.rootFlaggedLicenses.join(', ')}\`)`
    : `✅ \`${r.licenses.join(', ') || 'Unknown'}\` — Compliant`;

  const vulnStatus = r.vulnerabilities.length === 0
    ? '✅ No Known Vulnerabilities'
    : `❌ ${r.vulnerabilities.length} Vulns (${r.vulnerabilities.filter(v => v.severity === 'CRITICAL' || v.severity === 'HIGH').length} High/Critical)`;

  const scoreNum = r.scorecardScore;
  const scoreStatus = scoreNum === null
    ? '⚪ N/A'
    : scoreNum >= 7
      ? `🟢 ${scoreNum.toFixed(1)}/10`
      : scoreNum >= 4
        ? `🟡 ${scoreNum.toFixed(1)}/10 — Advisory`
        : `🔴 ${scoreNum.toFixed(1)}/10 — Below Threshold`;

  const policyStatus = hasBlock
    ? `❌ ${r.violations.filter(v => v.severity === 'HIGH').length} Blocking Issues`
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

// ─── Section: Findings & Actions (核心用戶指引) ───────────────────────────────

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
    '_Source: osv.dev_',
    '',
  ];

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
  const scoreStr = r.scorecardScore !== null ? `${scoreLight(r.scorecardScore)}` : '⚪ 無資料';

  const lines: string[] = [
    `## 📊 OpenSSF Scorecard (${scoreStr})`,
    '_Source: api.securityscorecards.dev_',
    '',
  ];

  if (r.scorecardChecks.length === 0) {
    lines.push('ℹ️ This package is not tracked by OpenSSF Scorecard (likely not hosted on GitHub).');
    lines.push('');
    return lines;
  }

  lines.push('<details>');
  lines.push('<summary>▶ Expand Detailed Scorecard Metrics</summary>');
  lines.push('');
  lines.push('> 💡 **Ecosystem Context:**');
  lines.push('> Large projects (e.g. Spring Boot, React) may score 0 in metrics like `Code-Review` if they use custom CI/CD or internal workflows instead of GitHub branch protections. This is common for enterprise repositories and can often be safely ignored.');
  lines.push('');
  lines.push('| Metric | Severity | Score |');
  lines.push('| :--- | :--- | :--- |');

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
    lines.push(`| ${c.name} | ${officialSev(c.officialSeverity)} | ${score} |`);
  }
  lines.push('');
  lines.push('</details>');
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
    '_Source: deps.dev_',
    '',
  ];

  lines.push('<details>');
  if (isAllClean) {
    lines.push(`<summary>✅ <strong>SBOM Clean:</strong> All ${total} dependencies are compliant and free of known vulnerabilities (Click to expand).</summary>`);
    lines.push('');
  } else {
    lines.push(`<summary>❌ <strong>SBOM Violation:</strong> Contains known vulnerabilities or restricted licenses (Click to expand).</summary>`);
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
  lines.push('</details>');
  lines.push('');
  
  return lines;
}

// ─── Section: Actionable Snippet ──────────────────────────────────────────────

import semver from 'semver';

function findSmartUpgrades(current: string, fixedVersions: string[]) {
  // Simple fallback for non-semver (e.g., Maven)
  let validFixed = fixedVersions.filter(v => semver.valid(v));
  if (validFixed.length === 0) {
    if (fixedVersions.length > 0) return { minimal: fixedVersions[fixedVersions.length - 1], latest: fixedVersions[fixedVersions.length - 1] };
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

      // 情境 1 & 2: 主套件漏洞處理
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
    // 情境 3: 影子相依漏洞處理 (Overrides)
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
    // 情境 4: 授權問題
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
  const failCount = results.filter(r =>
    r.violations.some(v => v.severity === 'HIGH' || v.severity === 'MEDIUM')
  ).length;
  const warnCount = results.filter(r =>
    !r.violations.some(v => v.severity === 'HIGH' || v.severity === 'MEDIUM') &&
    r.violations.some(v => v.severity === 'LOW')
  ).length;
  const passCount = results.length - failCount - warnCount;

  const overall = failCount > 0
    ? `> ❌ **${failCount} Packages Blocked** — You must submit an exception request and gain Security Team approval before installation.`
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
    `| ❌ Blocked | ${failCount} |`,
    '',
    overall,
  ].join('\n');
}
