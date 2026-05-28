import type {
  DepsDevVersionInfo,
  DepsDevDepsResponse,
  DepsDevScorecardResponse,
} from '../types.js';

const BASE = 'https://api.deps.dev/v3alpha';

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Get version info for a package (licenses, advisory count, etc.)
 */
export async function getVersionInfo(
  system: string,
  name: string,
  version?: string
): Promise<DepsDevVersionInfo | null> {
  // If no version specified, get the default version first
  if (!version) {
    const pkgUrl = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}`;
    const pkgData = await fetchJson<{ versions: Array<{ versionKey: { version: string }; isDefault?: boolean }> }>(pkgUrl);
    if (!pkgData?.versions?.length) return null;
    const defaultVer = pkgData.versions.find(v => v.isDefault) ?? pkgData.versions[pkgData.versions.length - 1];
    version = defaultVer.versionKey.version;
  }

  const url = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  return fetchJson<DepsDevVersionInfo>(url);
}

/**
 * Get dependency tree for a package version
 */
export async function getDependencies(
  system: string,
  name: string,
  version: string
): Promise<DepsDevDepsResponse | null> {
  const url = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}:dependencies`;
  return fetchJson<DepsDevDepsResponse>(url);
}

/**
 * Get OpenSSF Scorecard for a package
 */
export async function getScorecard(
  system: string,
  name: string,
  version: string
): Promise<DepsDevScorecardResponse | null> {
  // Scorecard is available via the project endpoint
  const versionUrl = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  const versionData = await fetchJson<{ links?: Array<{ label: string; url: string }> }>(versionUrl);

  // Try to get scorecard from the package's project
  const projectUrl = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}:scorecard`;
  // deps.dev doesn't expose scorecard directly on version; try project-level
  // Alternative: use the projects endpoint
  const projData = await fetchJson<DepsDevScorecardResponse>(projectUrl);
  if (projData?.overallScore !== undefined) return projData;

  // Fallback: try via advisory/project lookup
  return null;
}

/**
 * Build deps.dev URL for a package
 */
export function depsDevUrl(system: string, name: string, version?: string): string {
  const base = `https://deps.dev/${system.toLowerCase()}/${encodeURIComponent(name)}`;
  return version ? `${base}/${encodeURIComponent(version)}` : base;
}
