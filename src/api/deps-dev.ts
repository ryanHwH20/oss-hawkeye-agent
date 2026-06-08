import type {
  DepsDevVersionInfo,
  DepsDevDepsResponse,
  DepsDevScorecardResponse,
} from '../types.js';

const BASE = 'https://api.deps.dev/v3alpha';

// ─── In-Memory LRU Cache ─────────────────────────────────────────────────────

const CACHE_MAX = 200;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  // LRU: move to end
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
}

function cacheSet(key: string, value: unknown): void {
  // Evict oldest if at capacity
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Fetch Helper ─────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  const cached = cacheGet<T>(url);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    cacheSet(url, data);
    return data;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
 * Get OpenSSF Scorecard for a package via deps.dev project data
 */
export async function getScorecard(
  system: string,
  name: string,
  version: string
): Promise<DepsDevScorecardResponse | null> {
  // 1. Get version info to find the SOURCE_REPO link
  const versionUrl = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  const versionData = await fetchJson<{
    links?: Array<{ label: string; url: string }>;
    relatedProjects?: Array<{ projectKey: { id: string }; relationType: string }>;
  }>(versionUrl);

  // 2. Try to extract project ID from relatedProjects first (most reliable)
  let projectId: string | null = null;
  if (versionData?.relatedProjects) {
    const sourceProject = versionData.relatedProjects.find(p => p.relationType === 'SOURCE_REPO');
    if (sourceProject) {
      projectId = sourceProject.projectKey.id;
    }
  }

  // 3. Fallback: extract from links
  if (!projectId && versionData?.links) {
    const sourceLink = versionData.links.find(l => l.label === 'SOURCE_REPO');
    if (sourceLink?.url) {
      const match = sourceLink.url.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:]([^/]+\/[^/.]+)/);
      if (match) {
        const host = sourceLink.url.match(/(github\.com|gitlab\.com|bitbucket\.org)/);
        if (host) {
          projectId = `${host[1]}/${match[1]}`;
        }
      }
    }
  }

  if (!projectId) return null;

  // 4. Query the GetProject endpoint for scorecard
  const projectUrl = `${BASE}/projects/${encodeURIComponent(projectId)}`;
  const projData = await fetchJson<{
    scorecard?: {
      date: string;
      overallScore: number;
      checks: Array<{
        name: string;
        score: number;
        reason: string;
        documentation: { shortDescription: string; url: string };
      }>;
    };
  }>(projectUrl);

  if (!projData?.scorecard) return null;

  return {
    date: projData.scorecard.date,
    overallScore: projData.scorecard.overallScore,
    projectUrl,
    checks: projData.scorecard.checks,
  };
}

/**
 * Build deps.dev URL for a package
 */
export function depsDevUrl(system: string, name: string, version?: string): string {
  const base = `https://deps.dev/${system.toLowerCase()}/${encodeURIComponent(name)}`;
  return version ? `${base}/${encodeURIComponent(version)}` : base;
}
