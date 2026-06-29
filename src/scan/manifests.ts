import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** A direct dependency declared in a manifest. Version is undefined when the
 *  manifest only gives a range we can't resolve to a single version. */
export interface ManifestDependency {
  ecosystem: string;
  name: string;
  version?: string;
  /** Subresource-integrity hash from a lockfile, if present (npm verifies it on install). */
  integrity?: string;
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

/**
 * Parse an npm lockfile (`package-lock.json` / `npm-shrinkwrap.json`) into the
 * direct dependencies at their *resolved* versions — i.e. what npm actually
 * installs, not the declared range. This closes the "audited declared, not
 * installed" gap: `^4.17.1` is audited as the resolved `4.17.21`, not `4.17.1`.
 *
 * Transitive packages are intentionally not enumerated here (each direct
 * package's own graph is expanded for SBOM checks during the audit); this keeps
 * the scan bounded while making the versions accurate.
 */
export function parsePackageLock(content: string): ManifestDependency[] {
  const json = JSON.parse(content);
  const deps: ManifestDependency[] = [];

  // lockfileVersion 2/3: `packages` maps install paths → resolved metadata.
  const packages = json?.packages;
  if (packages && typeof packages === 'object') {
    const root = packages[''] ?? {};
    const directNames = new Set<string>();
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const obj = root[section];
      if (obj && typeof obj === 'object') for (const n of Object.keys(obj)) directNames.add(n);
    }
    for (const name of directNames) {
      const entry = packages[`node_modules/${name}`];
      const version = typeof entry?.version === 'string' ? entry.version : undefined;
      const integrity = typeof entry?.integrity === 'string' ? entry.integrity : undefined;
      deps.push({ ecosystem: 'NPM', name, version, integrity });
    }
    return deps;
  }

  // lockfileVersion 1: flat top-level `dependencies` map with a `version` each.
  const v1 = json?.dependencies;
  if (v1 && typeof v1 === 'object') {
    for (const [name, info] of Object.entries<Record<string, unknown>>(v1)) {
      const version = typeof info?.version === 'string' ? info.version : undefined;
      const integrity = typeof info?.integrity === 'string' ? info.integrity : undefined;
      deps.push({ ecosystem: 'NPM', name, version, integrity });
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

// Each ecosystem is a preference-ordered group: the first file that exists
// wins, so a lockfile (resolved versions) is preferred over the manifest
// (declared ranges). Within a directory we audit one source per ecosystem.
const MANIFEST_GROUPS: Array<Array<{ file: string; parse: (content: string) => ManifestDependency[] }>> = [
  [
    { file: 'package-lock.json', parse: parsePackageLock },
    { file: 'npm-shrinkwrap.json', parse: parsePackageLock },
    { file: 'package.json', parse: parsePackageJson },
  ],
  [
    { file: 'requirements.txt', parse: parseRequirementsTxt },
  ],
];

/** Detect and parse known manifests directly inside `dir`. */
export function detectManifests(dir: string): ParsedManifest[] {
  const found: ParsedManifest[] = [];
  for (const group of MANIFEST_GROUPS) {
    for (const { file, parse } of group) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      try {
        found.push({ file, dependencies: parse(readFileSync(path, 'utf-8')) });
        break; // first source in the group wins (lockfile over manifest)
      } catch {
        // Unreadable or malformed — try the next source in the group.
      }
    }
  }
  return found;
}
