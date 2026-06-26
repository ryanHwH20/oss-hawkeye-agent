import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'yaml';

/**
 * A documented, audited risk acceptance. Lives in `.hawkeye-exceptions.yaml` in
 * the repo, so it is a *human* artifact: a team pre-approves a specific package
 * (with a reason, and ideally an expiry) — an AI agent benefits from it but
 * cannot grant itself one. This is the legitimate escape hatch, so engineers
 * don't rip the guardrail out when a block is a known, accepted risk.
 */
export interface Exception {
  /** Package name the exception applies to (required). */
  package: string;
  /** Restrict to one ecosystem (NPM, PYPI, …). Omit to match any. */
  ecosystem?: string;
  /** Exact version to accept. Omit to accept any version (broader — use care). */
  version?: string;
  /** Why this risk is accepted (required; an empty reason never matches). */
  reason: string;
  /** ISO timestamp after which the exception is inert (fail-closed). Omit = no expiry. */
  expires?: string;
  /** Who signed off (recorded in the audit log). */
  approvedBy?: string;
}

/** Load risk-acceptance exceptions from `.hawkeye-exceptions.yaml` (cwd). */
export function loadExceptions(cwd: string = process.cwd()): Exception[] {
  const path = resolve(cwd, '.hawkeye-exceptions.yaml');
  if (!existsSync(path)) return [];
  try {
    const data = yaml.parse(readFileSync(path, 'utf-8'));
    const list = Array.isArray(data?.exceptions) ? data.exceptions : [];
    return list.filter(
      (e: unknown): e is Exception =>
        !!e && typeof (e as Exception).package === 'string' && typeof (e as Exception).reason === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Find an active exception covering a package, or null. Requires a matching
 * name, an optional matching ecosystem/version, a non-empty reason, and a
 * non-expired (and well-formed) date. Anything expired or malformed never
 * matches — the escape hatch itself fails closed.
 */
export function matchException(
  exceptions: Exception[],
  system: string,
  name: string,
  version: string,
  now: number = Date.now()
): Exception | null {
  for (const e of exceptions) {
    if (e.package !== name) continue;
    if (e.ecosystem && e.ecosystem.toUpperCase() !== system.toUpperCase()) continue;
    if (e.version && e.version !== version) continue;
    if (!e.reason?.trim()) continue;
    if (e.expires !== undefined) {
      const t = Date.parse(e.expires);
      if (Number.isNaN(t) || now > t) continue; // expired or unparseable → no match
    }
    return e;
  }
  return null;
}
