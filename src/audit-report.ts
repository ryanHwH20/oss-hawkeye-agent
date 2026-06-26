import type { AuditEntry } from './util/audit-log.js';

/**
 * Aggregated view of one or more audit logs — the measurable side of the
 * guardrail. Turns raw per-decision JSONL (written via HAWKEYE_AUDIT_LOG) into
 * the metrics an org cares about: how often installs are blocked, how often a
 * block is overridden, what gets blocked most, and why.
 */
export interface AuditReport {
  total: number;
  allow: number;
  block: number;
  override: number;
  /** Enforced blocks / all decisions. */
  blockRate: number;
  /** Overrides / (blocks + overrides) — how often a would-be block is waived. */
  overrideRate: number;
  topBlocked: Array<{ name: string; count: number }>;
  /** Violation-type counts across non-passing packages (MALWARE, TYPOSQUAT, …). */
  categories: Record<string, number>;
  overrides: Array<{ name: string; version: string; reason: string; approvedBy?: string }>;
}

/** Parse JSONL audit-log text into entries, skipping blank/malformed lines. */
export function parseAuditLog(text: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e && e.event === 'check-command' && typeof e.decision === 'string') out.push(e as AuditEntry);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export function aggregateAudit(entries: AuditEntry[]): AuditReport {
  let allow = 0, block = 0, override = 0;
  const blockedCount = new Map<string, number>();
  const categories: Record<string, number> = {};
  const overrides: AuditReport['overrides'] = [];

  for (const e of entries) {
    if (e.decision === 'allow') allow++;
    else if (e.decision === 'block') block++;
    else if (e.decision === 'override') override++;

    for (const p of e.packages ?? []) {
      if (p.verdict && p.verdict !== 'SAFE') {
        if (e.decision === 'block') blockedCount.set(p.name, (blockedCount.get(p.name) ?? 0) + 1);
        for (const c of p.categories ?? []) categories[c] = (categories[c] ?? 0) + 1;
      }
      if (p.override) overrides.push({ name: p.name, version: p.version, reason: p.override, approvedBy: p.approvedBy });
    }
  }

  const total = allow + block + override;
  const topBlocked = [...blockedCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    total, allow, block, override,
    blockRate: total ? block / total : 0,
    overrideRate: block + override ? override / (block + override) : 0,
    topBlocked, categories, overrides,
  };
}

export function formatAuditReport(r: AuditReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [
    '# 🎾 Hawkeye — Audit Report',
    '',
    `**${r.total}** decisions · ✅ ${r.allow} allowed · ❌ ${r.block} blocked · ⚠️ ${r.override} overridden`,
    '',
    `- **Block rate:** ${pct(r.blockRate)}`,
    `- **Override rate:** ${pct(r.overrideRate)} of would-be blocks`,
    '',
  ];

  const cats = Object.entries(r.categories).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    lines.push('## Findings by category', '', '| Category | Count |', '| :-- | --: |');
    for (const [cat, count] of cats) lines.push(`| ${cat} | ${count} |`);
    lines.push('');
  }

  if (r.topBlocked.length) {
    lines.push('## Most-blocked packages', '', '| Package | Times blocked |', '| :-- | --: |');
    for (const b of r.topBlocked) lines.push(`| \`${b.name}\` | ${b.count} |`);
    lines.push('');
  }

  if (r.overrides.length) {
    lines.push(`## Overrides (${r.overrides.length})`, '', '| Package | Reason | Approved by |', '| :-- | :-- | :-- |');
    for (const o of r.overrides) lines.push(`| \`${o.name}@${o.version}\` | ${o.reason} | ${o.approvedBy ?? '—'} |`);
    lines.push('');
  }

  if (r.total === 0) lines.push('_No audit records found. Set `HAWKEYE_AUDIT_LOG` to start recording decisions._', '');
  return lines.join('\n');
}
