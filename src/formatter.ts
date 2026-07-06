import semver from 'semver';
import type { CheckResult, OsvVuln, ScorecardOfficialSeverity } from './types.js';
import type { ScanReport } from './scan/scan.js';
import type { CommandAudit } from './command.js';
import type { Finding } from './util/baseline.js';
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

// ─── Install Plan (concise, action-first install-gate output) ─────────────────

/** A single `name@version` to feed into a consolidated install command. */
interface InstallEntry { name: string; version: string; }

/** Escape a cell value so long free-text reasons can't break the table.
 * Backslashes are escaped first so an existing `\` can't combine with the pipe
 * escape we add (incomplete-sanitization otherwise). */
function cell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * Render one package spec for a system's install command, e.g. `axios@1.16.0`
 * (npm) or `requests==2.32.0` (pip). Versionless entries fall back to the bare
 * name so the manager resolves the latest.
 */
function pkgToken(system: string, e: InstallEntry): string {
  const v = e.version;
  switch (system) {
    case 'PYPI':   return v ? `${e.name}==${v}` : e.name;
    case 'GO':     return v ? `${e.name}@v${v.replace(/^v/, '')}` : e.name;
    default:       return v ? `${e.name}@${v}` : e.name; // NPM, CARGO, and fallthrough
  }
}

/**
 * Build a single, copy-paste-ready install command that pins every *installable*
 * package to a safe version. Ecosystems that don't cleanly combine multiple
 * versioned packages on one line (gem/dotnet/maven) get one command per line.
 * Returns '' when there is nothing safe to install.
 */
export function buildInstallCommand(system: string, entries: InstallEntry[], tool?: string): string {
  if (entries.length === 0) return '';
  switch (system) {
    case 'RUBYGEMS':
      return entries.map(e => e.version ? `gem install ${e.name} -v ${e.version}` : `gem install ${e.name}`).join('\n');
    case 'NUGET':
      return entries.map(e => e.version ? `dotnet add package ${e.name} --version ${e.version}` : `dotnet add package ${e.name}`).join('\n');
    case 'MAVEN':
      return entries.map(e => `mvn dependency:get -Dartifact=${e.name}${e.version ? ':' + e.version : ''}`).join('\n');
    case 'PYPI':
      return `pip install ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    case 'CARGO':
      return `cargo add ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    case 'GO':
      return `go get ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    case 'NPM': {
      // Preserve the manager the developer actually invoked so the fix matches
      // their workflow (yarn/pnpm/bun use `add`, npm uses `install`).
      const t = (tool ?? 'npm').toLowerCase();
      const verb = t === 'yarn' ? 'yarn add' : t === 'pnpm' ? 'pnpm add' : t === 'bun' ? 'bun add' : 'npm install';
      return `${verb} ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    }
    default:
      return `${entries.map(e => pkgToken(system, e)).join(' ')}`;
  }
}

/** Short, table-friendly reason a package did not simply pass. */
function planReason(r: CheckResult): string {
  const v = r.violations.find(x => x.severity !== 'LOW') ?? r.violations[0];
  if (v) return v.reason;
  if (r.verdict === 'UNKNOWN') return `unverified: ${r.unverified.join(', ')}`;
  const advisory = r.violations.find(x => x.severity === 'LOW');
  return advisory ? advisory.reason : '';
}

/**
 * One-page, decision-first install report: a scannable Install Plan table, a
 * single copy-paste "safe install command" that pins every fixable package to a
 * verified-clean version, and an honest manual-attention list for the packages
 * no version swap can rescue. This is the developer-facing body of
 * `hawkeye check-command` — the verbose per-source audit lives in `formatResult`.
 */
export function formatInstallPlan(audit: CommandAudit): string {
  const system = audit.system ?? '';
  const tool = audit.command.trim().split(/\s+/)[0];
  const overrideByPkg = new Map(audit.overrides.map(o => [`${o.name}@${o.version}`, o]));
  const remByPkg = new Map(audit.remediation.map(rem => [`${rem.name}@${rem.current}`, rem]));

  const lines: string[] = [`\`${audit.command}\` → ${system}`, ''];

  // ── Build the plan rows and, in the same pass, the install/manual buckets ──
  const installable: InstallEntry[] = [];
  const manual: Array<{ label: string; reason: string }> = [];
  let replacedCount = 0;

  const rows: string[] = [];
  for (const r of audit.results) {
    const key = `${r.name}@${r.version}`;
    const requested = r.version || 'latest';
    const ov = overrideByPkg.get(key);
    const rem = remByPkg.get(key);

    let result: string;
    let fix: string;

    if (r.verdict === 'SAFE') {
      const advisory = r.violations.some(v => v.severity === 'LOW');
      result = advisory ? '⚠️ Advisory' : '✅ Pass';
      fix = '✅ install';
      installable.push({ name: r.name, version: r.version });
    } else if (ov) {
      result = `⚠️ ${ov.originalVerdict} (exception)`;
      fix = '⚠️ exception';
      installable.push({ name: r.name, version: r.version });
    } else if (rem && rem.action === 'upgrade' && rem.recommendedVersion) {
      result = '❌ Blocked';
      fix = `→ \`${rem.recommendedVersion}\``;
      installable.push({ name: r.name, version: rem.recommendedVersion });
      replacedCount++;
    } else if (r.verdict === 'UNKNOWN') {
      result = '⚠️ Unverified';
      fix = '⛔ verify';
      manual.push({ label: `${r.name}@${requested}`, reason: rem?.reason ?? planReason(r) });
    } else {
      result = '❌ Blocked';
      fix = '⛔ manual';
      manual.push({ label: `${r.name}@${requested}`, reason: rem?.reason ?? planReason(r) });
    }

    rows.push(`| \`${r.name}\` | \`${requested}\` | ${result} | ${fix} | ${cell(planReason(r))} |`);
  }

  lines.push('## Install Plan', '',
    '| Package | Requested | Result | Fix | Reason |',
    '| :-- | :-- | :-- | :-- | :-- |',
    ...rows, '');

  // ── The consolidated command (the headline action) ──
  if (installable.length > 0 && (replacedCount > 0 || manual.length > 0)) {
    const cmd = buildInstallCommand(system, installable, tool);
    const lang = system === 'MAVEN' ? 'xml' : 'bash';
    lines.push('## ✅ Safe install command', '', '```' + lang, cmd, '```', '');
    if (manual.length > 0) {
      const total = audit.results.length;
      lines.push(`> Resolves ${installable.length} of ${total} packages. ${manual.length} need manual attention (see below).`, '');
    }
  } else if (manual.length === 0) {
    // Everything passed as requested — the original command already stands.
    lines.push('✅ All packages approved — install as requested.', '');
  } else {
    lines.push('## ⛔ No safe install command', '',
      'None of the requested packages can be safely installed as-is. See manual attention below.', '');
  }

  // ── Packages no version swap can rescue ──
  if (manual.length > 0) {
    lines.push('## ⛔ Needs manual attention', '');
    for (const m of manual) lines.push(`- \`${m.label}\` — ${m.reason}`);
    lines.push('');
    if (policy.exceptionFormUrl) {
      lines.push(`> Need one of these anyway? Request a documented exception: ${policy.exceptionFormUrl}`, '');
    }
  }

  // ── Documented exceptions that let an otherwise-blocked install proceed ──
  if (audit.overrides.length > 0) {
    lines.push('## ⚠️ Allowed via documented exception', '');
    for (const o of audit.overrides) {
      const who = o.approvedBy ? ` (approved by ${o.approvedBy})` : '';
      lines.push(`- \`${o.name}@${o.version}\` was ${o.originalVerdict}${who} — risk accepted: ${o.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── PR Change Note (paste-ready justification for a blocked/fixed install) ────

/** How risky an upgrade is, from the semver distance current → next. */
function compatNote(current: string, next: string): string {
  if (!current || !semver.valid(current) || !semver.valid(next)) {
    return 'Verify the resolved version range before merging.';
  }
  const diff = semver.diff(current, next);
  if (diff === null) return 'Same version — no change.';
  if (diff.includes('major')) return '⚠️ **Major** version bump — review the changelog for breaking changes.';
  if (diff.includes('minor')) return 'Minor bump — backward-compatible under semver.';
  return 'Patch bump — drop-in fix.';
}

/**
 * Generate a paste-ready PR change note for an audited install command. When
 * Hawkeye blocked packages and found verified-safe upgrades, this documents the
 * *why* (risk), the *what* (version change + semver impact), a compatibility
 * caveat, and a testing checklist — the text a reviewer needs to approve a
 * security-driven dependency bump. All data comes from the same re-verified
 * remediation the install gate produces.
 */
export function formatPrNote(audit: CommandAudit): string {
  const overrideByPkg = new Map(audit.overrides.map(o => [`${o.name}@${o.version}`, o]));
  const remByPkg = new Map(audit.remediation.map(rem => [`${rem.name}@${rem.current}`, rem]));

  const upgrades: Array<{ name: string; from: string; to: string; reason: string }> = [];
  const risks: Array<{ pkg: string; reason: string }> = [];
  const manual: Array<{ pkg: string; reason: string }> = [];

  for (const r of audit.results) {
    if (r.verdict === 'SAFE') continue;
    const key = `${r.name}@${r.version}`;
    if (overrideByPkg.has(key)) continue; // approved via exception — not a change to justify here
    risks.push({ pkg: key, reason: planReason(r) });
    const rem = remByPkg.get(key);
    if (rem && rem.action === 'upgrade' && rem.recommendedVersion) {
      upgrades.push({ name: r.name, from: r.version || 'latest', to: rem.recommendedVersion, reason: planReason(r) });
    } else {
      manual.push({ pkg: `${r.name}@${r.version || 'latest'}`, reason: rem?.reason ?? planReason(r) });
    }
  }

  // Nothing was blocked → no security change to document.
  if (risks.length === 0) {
    return [
      '## 🎾 Hawkeye — dependency security note',
      '',
      `✅ All packages in \`${audit.command}\` passed Hawkeye's supply-chain audit. No security-blocking changes were required.`,
    ].join('\n');
  }

  const lines: string[] = [
    '## 🎾 Hawkeye — dependency security note',
    '',
    'Hawkeye blocked the original install; this change applies the verified-safe fix.',
    '',
    '### Risk summary',
  ];
  for (const r of risks) lines.push(`- \`${r.pkg}\` — ${r.reason}`);
  lines.push('');

  if (upgrades.length > 0) {
    lines.push('### Applied fix', '',
      '| Package | From | To | Impact |', '| :-- | :-- | :-- | :-- |');
    for (const u of upgrades) {
      lines.push(`| \`${u.name}\` | \`${u.from}\` | \`${u.to}\` | ${cell(compatNote(u.from, u.to))} |`);
    }
    lines.push('',
      '### Compatibility');
    for (const u of upgrades) {
      lines.push(`- \`${u.name}\` \`${u.from}\` → \`${u.to}\`: ${compatNote(u.from, u.to)}`);
    }
    lines.push('');
  }

  if (manual.length > 0) {
    lines.push('### ⛔ Still needs manual attention', '');
    for (const m of manual) lines.push(`- \`${m.pkg}\` — ${m.reason}`);
    lines.push('');
  }

  lines.push('### Testing',
    '- [ ] Run the full test suite',
    ...[...new Set(upgrades.map(u => u.name))].map(n => `- [ ] Smoke-test the paths that use \`${n}\``),
    ...(upgrades.some(u => compatNote(u.from, u.to).includes('Major'))
      ? ['- [ ] Review breaking-change notes for the major bump(s) above']
      : []),
    '');

  lines.push('<sub>🎾 Generated by [Hawkeye Agent](https://github.com/ryanHwH20/oss-hawkeye-agent) — versions above were re-audited and pass.</sub>');

  return lines.join('\n');
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

// ─── Baseline Scan (delta report — only what changed) ─────────────────────────

/** Group findings by package for a compact, per-package listing. */
function findingsByPackage(findings: Finding[]): Array<{ package: string; system: string; reasons: string[] }> {
  const map = new Map<string, { package: string; system: string; reasons: string[] }>();
  for (const f of findings) {
    const entry = map.get(f.package) ?? { package: f.package, system: f.system, reasons: [] };
    entry.reasons.push(f.summary);
    map.set(f.package, entry);
  }
  return [...map.values()];
}

/**
 * Delta report for a baselined scan: leads with what is **new since the
 * baseline** (the only thing that fails CI), and collapses already-known risks
 * into a count so the signal stays on the change under review.
 */
export function formatBaselineScan(
  path: string,
  newFindings: Finding[],
  knownFindings: Finding[]
): string {
  const hasNewBlock = newFindings.some(f => f.category !== 'UNVERIFIED');
  const hasNewUnknown = newFindings.some(f => f.category === 'UNVERIFIED');
  const badge = hasNewBlock ? '❌  NEW RISK' : hasNewUnknown ? '⚠️  NEW UNVERIFIED' : '✅  NO NEW RISK';

  const lines: string[] = [
    `# 🎾 Baseline Scan — ${badge}`,
    '',
    `**Path:** \`${path}\` · 🆕 ${newFindings.length} new · 📌 ${knownFindings.length} known (baselined)`,
    '',
  ];

  if (newFindings.length === 0) {
    lines.push(
      knownFindings.length > 0
        ? `> ✅ No new risks introduced. ${knownFindings.length} pre-existing risk(s) remain baselined — tracked, not re-alerted.`
        : '> ✅ No risks found, and none baselined. Clean scan.',
      '');
  } else {
    lines.push('## 🆕 New since baseline — action required', '',
      '> These risks are **not** in the baseline. They are what this change introduced.', '',
      '| Package | Ecosystem | Reason |', '| :-- | :-- | :-- |');
    for (const g of findingsByPackage(newFindings)) {
      lines.push(`| \`${g.package}\` | ${g.system} | ${cell(g.reasons.join('; '))} |`);
    }
    lines.push('',
      '> To accept these as the new known state, re-generate the baseline: `hawkeye baseline .`', '');
  }

  if (knownFindings.length > 0) {
    lines.push(`<details><summary><strong>📌 Known risks in baseline (${knownFindings.length})</strong></summary>`, '',
      '| Package | Ecosystem | Reason |', '| :-- | :-- | :-- |');
    for (const g of findingsByPackage(knownFindings)) {
      lines.push(`| \`${g.package}\` | ${g.system} | ${cell(g.reasons.join('; '))} |`);
    }
    lines.push('', '</details>', '');
  }

  return lines.join('\n');
}
