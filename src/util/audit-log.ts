import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** What the guardrail did with a command, for the audit trail / telemetry. */
export type AuditDecision = 'allow' | 'block' | 'override';

export interface AuditEntry {
  ts: string;
  event: 'check-command';
  command: string;
  system?: string;
  /** Enforced outcome: allow (clean), block (failed closed), override (allowed via exception). */
  decision: AuditDecision;
  /** Raw audited verdict before any exception was applied. */
  verdict: string;
  packages: Array<{
    name: string;
    version: string;
    verdict: string;
    /** Reason recorded when this package was allowed via a documented exception. */
    override?: string;
    approvedBy?: string;
  }>;
}

/**
 * Append one JSONL record to the audit log when `HAWKEYE_AUDIT_LOG` is set.
 * This is the enterprise telemetry hook — point it at a central path to measure
 * block rate, override rate, and fix conversion. Best-effort: a logging failure
 * must never break an audit (or, via the hook, an install).
 */
export function recordAudit(entry: AuditEntry): void {
  const path = process.env.HAWKEYE_AUDIT_LOG;
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + '\n');
  } catch {
    // best-effort telemetry — swallow
  }
}
