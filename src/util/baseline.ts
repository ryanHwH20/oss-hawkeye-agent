import { readFileSync } from 'node:fs';
import type { ScanReport } from '../scan/scan.js';

/**
 * Project baseline — a snapshot of the risks a scan *already knows about*, so a
 * later scan can report only what is **new**.
 *
 * This is deliberately different from `.hawkeye-exceptions.yaml`:
 *  - An **exception** is a reviewed, deliberate *approval* — the package is
 *    treated as SAFE (it passes, and the override is recorded with a reason and
 *    approver).
 *  - A **baseline** grants no approval. Every risk is still real and still
 *    reported; the baseline only stops a CI gate from re-failing on risks that
 *    were already present, so the signal is "what did *this change* introduce?".
 *
 * Only gating findings (BLOCKED violations and UNVERIFIED packages) are tracked
 * — advisories never fail a scan, so there is nothing to baseline.
 */

const BASELINE_VERSION = 1;

/** One gating finding, identified by a stable, prose-free fingerprint. */
export interface Finding {
  /** Stable identity used for diffing — never includes free-text reasons. */
  fingerprint: string;
  /** `name@version` of the audited package. */
  package: string;
  system: string;
  /** Violation type (e.g. `VULNERABILITY`) or `UNVERIFIED`. */
  category: string;
  /** Human-readable one-liner, shown in reports (not used for matching). */
  summary: string;
}

export interface BaselineFile {
  version: number;
  generatedAt?: string;
  findings: Finding[];
}

/**
 * Extract the gating findings from a scan: one per blocking violation, plus one
 * per package that could not be verified. Fingerprints use only stable
 * identifiers (system, coordinates, violation type, offending dep) so a re-scan
 * matches even if a reason string is later reworded — while a genuinely new CVE
 * (new violation type or new offending dep) still shows up as new.
 */
export function collectFindings(report: ScanReport): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const add = (f: Finding) => {
    if (seen.has(f.fingerprint)) return;
    seen.add(f.fingerprint);
    findings.push(f);
  };

  for (const r of report.results) {
    const pkg = `${r.name}@${r.version}`;
    if (r.verdict === 'BLOCKED') {
      // Blocking violations only; if somehow none are marked blocking, fall back
      // to all so a BLOCKED package is never dropped from the baseline.
      const blocking = r.violations.filter(v => v.severity !== 'LOW');
      const vios = blocking.length > 0 ? blocking : r.violations;
      for (const v of vios) {
        add({
          fingerprint: `${r.system}|${pkg}|${v.type}|${v.affectedDep ?? ''}`,
          package: pkg, system: r.system, category: v.type, summary: v.reason,
        });
      }
    } else if (r.verdict === 'UNKNOWN') {
      add({
        fingerprint: `${r.system}|${pkg}|UNVERIFIED`,
        package: pkg, system: r.system, category: 'UNVERIFIED',
        summary: `could not verify ${r.unverified.join(', ')}`,
      });
    }
  }

  return findings;
}

/** Build a baseline document from the current scan state. */
export function buildBaseline(report: ScanReport, generatedAt?: string): BaselineFile {
  return {
    version: BASELINE_VERSION,
    ...(generatedAt ? { generatedAt } : {}),
    // Sorted for a stable, review-friendly diff in git.
    findings: collectFindings(report).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  };
}

/**
 * Load a baseline's fingerprints from disk. Returns `null` when the file is
 * missing or unreadable so the caller can decide how to treat "no baseline"
 * (we treat it as empty — everything is new — and warn).
 */
export function loadBaselineFingerprints(path: string): Set<string> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as BaselineFile;
    const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
    return new Set(findings.map(f => f.fingerprint).filter(fp => typeof fp === 'string'));
  } catch {
    // A corrupt baseline must not silently disable the gate.
    return new Set();
  }
}

/** Split current findings into those new since the baseline and those already known. */
export function partitionFindings(findings: Finding[], baseline: Set<string>): {
  newFindings: Finding[];
  knownFindings: Finding[];
} {
  const newFindings: Finding[] = [];
  const knownFindings: Finding[] = [];
  for (const f of findings) {
    (baseline.has(f.fingerprint) ? knownFindings : newFindings).push(f);
  }
  return { newFindings, knownFindings };
}
