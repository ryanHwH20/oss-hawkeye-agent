import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** A direct dependency declared in a manifest. Version is undefined when the
 *  manifest only gives a range we can't resolve to a single version. */
export interface ManifestDependency {
  ecosystem: string;
  name: string;
  version?: string;
}

export interface ParsedManifest {
  file: string;
  dependencies: ManifestDependency[];
}

// ─── Version-spec normalization ──────────────────────────────────────────────

const SEMVERISH = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

/**
 * Reduce an npm version range to a concrete version we can audit. `^4.17.1`
 * and `~4.17.1` → `4.17.1`; non-registry specs (git/file/workspace/url) and
 * wildcards return undefined so the default version is audited instead.
 */
function npmVersion(spec: string): string | undefined {
  const s = spec.trim();
  if (!s || /^(?:npm:|file:|link:|git|github:|workspace:|https?:|portal:)/i.test(s)) return undefined;
  const m = s.match(SEMVERISH) ?? s.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : undefined;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

export function parsePackageJson(content: string): ManifestDependency[] {
  const json = JSON.parse(content);
  const deps: ManifestDependency[] = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const obj = json?.[section];
    if (obj && typeof obj === 'object') {
      for (const [name, spec] of Object.entries(obj)) {
        deps.push({ ecosystem: 'NPM', name, version: npmVersion(String(spec)) });
      }
    }
  }
  return deps;
}

export function parseRequirementsTxt(content: string): ManifestDependency[] {
  const deps: ManifestDependency[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue; // skip blanks, comments, -r/-e options
    // Only a `==` pin yields a concrete version; ranges (>=, ~=, …) audit the default.
    const m = line.match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:==\s*([^\s;,]+))?/);
    if (m) deps.push({ ecosystem: 'PYPI', name: m[1], version: m[2] });
  }
  return deps;
}

// ─── Detection ───────────────────────────────────────────────────────────────

const PARSERS: Array<{ file: string; parse: (content: string) => ManifestDependency[] }> = [
  { file: 'package.json', parse: parsePackageJson },
  { file: 'requirements.txt', parse: parseRequirementsTxt },
];

/** Detect and parse known manifests directly inside `dir`. */
export function detectManifests(dir: string): ParsedManifest[] {
  const found: ParsedManifest[] = [];
  for (const { file, parse } of PARSERS) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      found.push({ file, dependencies: parse(readFileSync(path, 'utf-8')) });
    } catch {
      // Unreadable or malformed manifest — skip rather than crash the scan.
    }
  }
  return found;
}
