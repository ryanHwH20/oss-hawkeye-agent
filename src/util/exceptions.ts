import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'yaml';

const FILE = '.hawkeye-exceptions.yaml';

/**
 * A documented, audited risk acceptance. Lives in `.hawkeye-exceptions.yaml` in
 * the repo. To make it a genuine *human* artifact — and not something the very
 * agent being gated can grant itself — exceptions only take effect when the
 * file is **committed to git and unmodified in the working tree**, so granting
 * one leaves a reviewable commit. An agent that merely writes an uncommitted
 * file is ignored. (A same-machine attacker who can also forge commits is out
 * of scope, exactly as for the cache HMAC — but abuse is now in the git record.)
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

function git(cwd: string, args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the exceptions file is trustworthy provenance: committed to git and
 * unmodified vs HEAD. Outside a git repo (or with the explicit env override) we
 * can't verify, so we honor it. Returns a reason for the warning when not.
 */
export function exceptionsTrust(cwd: string): { trusted: boolean; reason: string } {
  if (process.env.HAWKEYE_TRUST_UNCOMMITTED_EXCEPTIONS) return { trusted: true, reason: 'override' };
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree'])) {
    return { trusted: true, reason: 'not a git repo — provenance unverifiable' };
  }
  if (!git(cwd, ['ls-files', '--error-unmatch', '--', FILE])) {
    return { trusted: false, reason: 'the file is not committed to git (untracked)' };
  }
  if (!git(cwd, ['diff', '--quiet', 'HEAD', '--', FILE])) {
    return { trusted: false, reason: 'the file has uncommitted modifications' };
  }
  return { trusted: true, reason: 'committed' };
}

/** Load risk-acceptance exceptions from `.hawkeye-exceptions.yaml` (cwd). */
export function loadExceptions(cwd: string = process.cwd()): Exception[] {
  const path = resolve(cwd, FILE);
  if (!existsSync(path)) return [];

  let list: Exception[];
  try {
    const data = yaml.parse(readFileSync(path, 'utf-8'));
    const raw = Array.isArray(data?.exceptions) ? data.exceptions : [];
    list = raw.filter(
      (e: unknown): e is Exception =>
        !!e && typeof (e as Exception).package === 'string' && typeof (e as Exception).reason === 'string'
    );
  } catch {
    return [];
  }
  if (list.length === 0) return [];

  // Provenance gate: an uncommitted exceptions file (e.g. one a gated agent just
  // wrote to whitelist itself) is ignored, fail-closed, with a loud warning.
  const trust = exceptionsTrust(cwd);
  if (!trust.trusted) {
    process.stderr.write(
      `⚠️  Hawkeye: ignoring ${FILE} — ${trust.reason}. Exceptions take effect only when ` +
        `committed to git (so granting one is reviewable). Commit it, or set ` +
        `HAWKEYE_TRUST_UNCOMMITTED_EXCEPTIONS=1 to override.\n`
    );
    return [];
  }
  return list;
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
