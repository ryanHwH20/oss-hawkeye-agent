import type { CheckResult, Policy, OsvVuln } from './types.js';
import { loadPolicy } from './policy.js';

const policy = loadPolicy();

// ─── Ossie Header ────────────────────────────────────────────────────────────

function ossieHeader(): string {
  const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  return [
    '# 🛡️ CathayOSSGuard',
    'Open Source Compliance Report · Powered by Ossie',
    '',
    '> Ossie 是國泰的開源合規守護大使，在每個套件進入程式碼庫前，',
    '> 進行授權風險、資安態勢與公司政策的全面評估。',
    '',
    `\`Scanned at ${ts} (UTC+8)\``,
    '',
    '---',
    '',
  ].join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scorecardBadge(score: number): string {
  if (score >= 7) return `\`${score.toFixed(1)}/10\` 🟢`;
  if (score >= 4) return `\`${score.toFixed(1)}/10\` 🟡`;
  return `\`${score.toFixed(1)}/10\` 🔴`;
}

function severityBadge(s: OsvVuln['severity']): string {
  switch (s) {
    case 'CRITICAL': return '🔴 CRITICAL';
    case 'HIGH':     return '🟠 HIGH';
    case 'MEDIUM':   return '🟡 MEDIUM';
    case 'LOW':      return '🔵 LOW';
    default:         return '⚪ UNKNOWN';
  }
}

function depsDevUrl(system: string, name: string, version?: string): string {
  const base = `https://deps.dev/${system.toLowerCase()}/${encodeURIComponent(name)}`;
  return version ? `${base}/${encodeURIComponent(version)}` : base;
}

// ─── Ossie Verdict ───────────────────────────────────────────────────────────

function ossieVerdict(r: CheckResult): string {
  const warn = r.violations.filter((v) => v.severity === 'HIGH' || v.severity === 'MEDIUM');

  if (warn.length > 0) {
    const vulnWarn = warn.filter((v) => v.type === 'VULNERABILITY');
    const licWarn = warn.filter((v) => v.type === 'LICENSE' || v.type === 'SBOM_LICENSE');
    const parts: string[] = [];
    if (vulnWarn.length > 0) parts.push(`${vulnWarn.length} 項已知漏洞風險`);
    if (licWarn.length > 0) parts.push(`${licWarn.length} 項授權違規`);
    const note = parts.length > 0 ? parts.join('、') : `${warn.length} 項政策違規`;
    return [
      '',
      '---',
      `### Ossie's Compliance Decision`,
      `> ⚠️ WARN — Exception Required — 本套件存在 ${note}，使用前須完成例外申請並取得 OSRB 團隊核准。`,
      `> ① [填寫例外申請表單 ↗](${policy.exceptionFormUrl})　② 通知 OSRB 團隊說明影響範圍　③ 訂立升級時程承諾`,
      '---',
    ].join('\n');
  }

  return [
    '',
    '---',
    `### Ossie's Compliance Decision`,
    `> ✅ APPROVED — 本套件通過所有合規審查，授權與安全指標均符合公司政策，可正常引入。`,
    '---',
  ].join('\n');
}

// ─── Vulnerability Section ───────────────────────────────────────────────────

function formatVulnerabilitiesSection(r: CheckResult): string[] {
  if (r.vulnerabilities.length === 0) return [];
  const lines: string[] = [];

  lines.push('### Known Vulnerabilities');
  lines.push('');
  lines.push('> 掃描引擎： [osv.dev API ↗](https://osv.dev) · 涵蓋 OSV、GitHub Advisory Database、NVD 等多個資料庫。');
  lines.push('');
  lines.push('| Package | ID | Severity | Aliases | Summary | Fixed In |');
  lines.push('|---------|----|---------:|---------|---------|----------|');

  for (const v of r.vulnerabilities) {
    const cveIds = v.aliases.filter(a => a.startsWith('CVE-') || a.startsWith('GHSA-'));
    const cveStr = cveIds.length > 0
      ? cveIds.map(id => `[\`${id}\`](https://osv.dev/vulnerability/${id})`).join(', ')
      : '—';
    const fixedStr = v.fixedVersions.length > 0
      ? v.fixedVersions.map(f => `\`${f}\``).join(', ')
      : '⚠️ 尚無修復版本';
    lines.push(`| \`${r.name}\` | [${v.id}](${v.url}) | ${severityBadge(v.severity)} | ${cveStr} | ${v.summary} | ${fixedStr} |`);
  }
  lines.push('');
  return lines;
}

// ─── Action Plan ─────────────────────────────────────────────────────────────

function formatActionPlan(r: CheckResult): string[] {
  const blocking = r.violations.filter((v) => v.severity === 'HIGH' || v.severity === 'MEDIUM');
  if (blocking.length === 0) return [];

  const lines: string[] = [];
  lines.push('### 🎯 Developer Action Plan');
  lines.push('');
  lines.push('> 本套件被攔截。請依以下選項評估處置方式：');
  lines.push('');

  // Option A — upgrade
  const fixableVulns = r.vulnerabilities.filter(
    v => (v.severity === 'CRITICAL' || v.severity === 'HIGH' || v.severity === 'MEDIUM') && v.fixedVersions.length > 0
  );
  if (fixableVulns.length > 0) {
    const fixVersions = [...new Set(fixableVulns.flatMap(v => v.fixedVersions))].slice(0, 3);
    lines.push('**Option A — ⬆️ 升級至修復版本（最快 · 無需例外申請）**');
    lines.push('');
    lines.push(`已知修復版本：${fixVersions.map(v => `\`${v}\``).join('、')} — 升級後重新掃描即可通過。`);
    lines.push('');
  }

  // Option B — replace
  if (r.alternatives.length > 0) {
    lines.push('**Option B — 🔄 替換套件（見下方 Recommended Alternatives）**');
    lines.push('');
    lines.push(`已找到 ${r.alternatives.length} 個通過合規審查的替代套件，評估後可直接替換。`);
    lines.push('');
  }

  // Option C — exception
  lines.push('**Option C — 📋 申請例外使用（需 OSRB 團隊核准）**');
  lines.push('');
  lines.push(`1. [📋 填寫例外申請表單 ↗](${policy.exceptionFormUrl})`);
  lines.push('2. 📢 通知 OSRB 團隊說明業務需求及影響範圍');
  lines.push('3. 🗓️ 承諾在修復版本釋出後 30 天內完成升級');
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines;
}

// ─── Main Format Function ────────────────────────────────────────────────────

export function formatResult(r: CheckResult): string {
  const lines: string[] = [];

  lines.push(ossieHeader());

  // Package Identity
  const complianceStatus = r.violations.some((v) => v.severity === 'HIGH' || v.severity === 'MEDIUM')
    ? '⚠️ WARN — Exception Required'
    : '✅ APPROVED';
  lines.push(`## \`${r.name}@${r.version}\`  ·  ${r.system}`);
  lines.push('');
  lines.push(`**Compliance Status:** ${complianceStatus}`);
  lines.push('');

  // Action Plan
  lines.push(...formatActionPlan(r));

  // Security Overview
  lines.push('### Security Overview');
  lines.push('');
  lines.push('| Field | Value | 說明 |');
  lines.push('|-------|-------|------|');

  const licenseVal = r.licenses.length > 0 ? r.licenses.join(', ') : 'Unknown';
  const licenseFlag = r.rootFlaggedLicenses.length > 0 ? ' ⚠️' : '';
  lines.push(`| License | \`${licenseVal}\`${licenseFlag} | 套件宣告的 SPDX 授權識別碼 |`);

  const vulnVal = r.advisoryCount === 0 ? '✅ None' : `⚠️ ${r.advisoryCount} vulnerability(ies)`;
  lines.push(`| Known Vulnerabilities | ${vulnVal} | 來自 osv.dev API |`);

  lines.push(`| OpenSSF Scorecard | ${r.scorecardScore !== null ? scorecardBadge(r.scorecardScore) : '\`N/A\`'} | 開源安全評分 |`);
  lines.push(`| Direct Dependencies | ${r.depCount.direct} | 第一層依賴數量 |`);
  lines.push(`| Transitive Dependencies | ${r.depCount.indirect} | 間接依賴總數 |`);
  lines.push(`| Source | [deps.dev ↗](${r.depsDevUrl}) | 資料來源 |`);
  lines.push('');

  // Vulnerabilities
  lines.push(...formatVulnerabilitiesSection(r));

  // Scorecard Details
  if (r.scorecardChecks.length > 0) {
    lines.push('### OpenSSF Scorecard Details');
    lines.push('');
    lines.push(`> 評分日期：${r.scorecardDate ?? 'N/A'} · 總分：${r.scorecardScore !== null ? scorecardBadge(r.scorecardScore) : 'N/A'} · 門檻：\`${policy.minScorecardScore}/10\``);
    lines.push('');
    lines.push('| Check | Score | 說明 |');
    lines.push('|-------|------:|------|');
    for (const check of r.scorecardChecks) {
      const icon = check.score >= 7 ? '🟢' : check.score >= 4 ? '🟡' : '🔴';
      lines.push(`| ${check.name} | ${icon} ${check.score}/10 | ${check.documentation.shortDescription} |`);
    }
    lines.push('');
  }

  // SBOM
  if (r.depLicenses.length > 0) {
    lines.push('### Software Bill of Materials (SBOM)');
    lines.push('');
    const flaggedCount = r.depLicenses.filter(d => d.flagged.length > 0).length;
    lines.push(flaggedCount === 0
      ? `全部依賴套件均通過授權篩查，無受限授權。`
      : `⚠️ 共 ${flaggedCount} 個依賴含受限授權。`);
    lines.push('');
    lines.push('| Package | Version | Scope | License | Status |');
    lines.push('|---------|---------|-------|---------|--------|');

    const rootLic = r.licenses.length > 0 ? r.licenses.join(', ') : 'Unknown';
    const rootFlag = r.rootFlaggedLicenses.length > 0;
    lines.push(`| [${r.name}](${r.depsDevUrl}) | \`${r.version}\` | root | \`${rootLic}\` | ${rootFlag ? '⚠️ Restricted' : '✅ Clear'} |`);

    for (const dep of r.depLicenses.slice(0, 30)) { // cap at 30 to avoid huge output
      const lic = dep.licenses.length > 0 ? dep.licenses.join(', ') : 'Unknown';
      const flag = dep.flagged.length > 0;
      const scope = dep.relation === 'DIRECT' ? 'direct' : 'transitive';
      const depUrl = depsDevUrl(r.system, dep.name, dep.version);
      lines.push(`| [${dep.name}](${depUrl}) | \`${dep.version}\` | ${scope} | \`${lic}\` | ${flag ? `⚠️ \`${dep.flagged.join(', ')}\`` : '✅ Clear'} |`);
    }
    lines.push('');
  }

  // Policy Findings
  const blocking = r.violations.filter((v) => v.severity === 'HIGH');
  const needsException = r.violations.filter((v) => v.severity === 'MEDIUM');
  const advisory = r.violations.filter((v) => v.severity === 'LOW');

  if (r.violations.length === 0) {
    lines.push('### Policy Findings');
    lines.push('');
    lines.push('未偵測到任何政策違規。授權與資安審查均通過。');
    lines.push('');
  } else {
    if (blocking.length > 0 || needsException.length > 0) {
      lines.push('### Policy Findings — ⚠️ Exception Required');
      lines.push('');
      for (const v of blocking) {
        lines.push(`#### 🔴 HIGH · ${v.reason}`);
        lines.push('');
        if (v.details.length > 0) lines.push(`**Finding:** \`${v.details.join(', ')}\``);
        lines.push('');
        lines.push(`> 風險說明： ${v.riskExplanation}`);
        if (v.affectedDep) lines.push(`> Affected dependency: \`${v.affectedDep}\``);
        lines.push('');
      }
      for (const v of needsException) {
        lines.push(`#### 🟠 MEDIUM · ${v.reason}`);
        lines.push('');
        if (v.details.length > 0) {
          lines.push(`**Finding:** \`${v.details.join(', ')}\``);
          lines.push('');
        }
        lines.push(`> 風險說明： ${v.riskExplanation}`);
        if (v.affectedDep) lines.push(`> Affected dependency: \`${v.affectedDep}\``);
        lines.push('');
      }
    }

    if (advisory.length > 0) {
      lines.push('### Advisory Findings _(informational only, not blocking)_');
      lines.push('');
      for (const v of advisory) {
        lines.push(`- ⚪ ${v.reason}: ${v.details.join(', ')}`);
      }
      lines.push('');
    }

    // Alternatives
    if (r.alternatives.length > 0) {
      lines.push('### Recommended Alternatives');
      lines.push('');
      lines.push('| Package | Version | License | Vulnerabilities | 推薦原因 |');
      lines.push('|---------|---------|---------|-----------------|----------|');
      for (const alt of r.alternatives) {
        const lic = alt.licenses.length > 0 ? alt.licenses.join(', ') : 'Unknown';
        lines.push(`| [${alt.name}](${alt.depsDevUrl}) | \`${alt.version}\` | \`${lic}\` | ${alt.advisoryCount === 0 ? '✅ None' : alt.advisoryCount} | ${alt.reason} |`);
      }
      lines.push('');
    }
  }

  lines.push(ossieVerdict(r));
  return lines.join('\n');
}

// ─── Batch Command Verdict ───────────────────────────────────────────────────

export function formatCommandVerdict(results: CheckResult[]): string {
  const failCount = results.filter((r) =>
    r.violations.some((v) => v.severity === 'HIGH' || v.severity === 'MEDIUM')
  ).length;
  const passCount = results.length - failCount;

  const verdict = failCount > 0
    ? `> ⚠️ WARN — 共 ${failCount} 個套件需要申請例外，使用前須取得 OSRB 團隊核准。`
    : `> ✅ APPROVED — 全部 ${results.length} 個套件均通過合規審查，可安心安裝。`;

  return [
    '| Result | Count |',
    '|--------|------:|',
    `| Total packages scanned | ${results.length} |`,
    `| ✅ Approved | ${passCount} |`,
    `| ⚠️ Warn — Exception Required | ${failCount} |`,
    '',
    verdict,
  ].join('\n');
}

export { ossieHeader };
