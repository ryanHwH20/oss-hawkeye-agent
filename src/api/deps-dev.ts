import type {
  DepsDevVersionInfo,
  DepsDevDepsResponse,
  DepsDevScorecardResponse,
  SourceResult,
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

/**
 * Fetch JSON while distinguishing "source unreachable" from "no such resource".
 *
 * - `status: 'unavailable'` — network error, rate limit (429), or server error
 *   (5xx). We genuinely could not consult the source; callers must fail closed.
 * - `status: 'ok', value: null` — a clean 4xx (e.g. 404). The source answered:
 *   the resource does not exist. This is a real, trustworthy negative.
 * - `status: 'ok', value: T` — a successful response.
 */
async function fetchJson<T>(url: string): Promise<SourceResult<T | null>> {
  const cached = cacheGet<T>(url);
  if (cached !== undefined) return { value: cached, status: 'ok' };

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 429 (rate limited) and 5xx (server) mean we couldn't really check.
      if (res.status === 429 || res.status >= 500) {
        return { value: null, status: 'unavailable' };
      }
      // 404 and other 4xx are authoritative "not found" answers.
      return { value: null, status: 'ok' };
    }
    const data = (await res.json()) as T;
    cacheSet(url, data);
    return { value: data, status: 'ok' };
  } catch {
    // DNS failure, connection reset, timeout, malformed JSON, etc.
    return { value: null, status: 'unavailable' };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get version info for a package (licenses, advisory count, etc.)
 * The returned `status` reflects whether deps.dev could actually be reached.
 */
export async function getVersionInfo(
  system: string,
  name: string,
  version?: string
): Promise<SourceResult<DepsDevVersionInfo | null>> {
  // If no version specified, get the default version first
  if (!version) {
    const pkgUrl = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}`;
    const pkgRes = await fetchJson<{ versions: Array<{ versionKey: { version: string }; isDefault?: boolean }> }>(pkgUrl);
    // Propagate unreachability — don't mask a network failure as "not found".
    if (pkgRes.status === 'unavailable') return { value: null, status: 'unavailable' };
    const versions = pkgRes.value?.versions;
    if (!versions?.length) return { value: null, status: 'ok' };
    const defaultVer = versions.find(v => v.isDefault) ?? versions[versions.length - 1];
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
): Promise<SourceResult<DepsDevDepsResponse | null>> {
  const url = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}:dependencies`;
  return fetchJson<DepsDevDepsResponse>(url);
}

/**
 * Get OpenSSF Scorecard for a package via deps.dev project data.
 * `status: 'unavailable'` distinguishes "deps.dev unreachable" from the
 * legitimate "this project simply has no scorecard" (status 'ok', value null).
 */
export async function getScorecard(
  system: string,
  name: string,
  version: string
): Promise<SourceResult<DepsDevScorecardResponse | null>> {
  // 1. Get version info to find the SOURCE_REPO link
  const versionUrl = `${BASE}/systems/${encodeURIComponent(system)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  const versionRes = await fetchJson<{
    links?: Array<{ label: string; url: string }>;
    relatedProjects?: Array<{ projectKey: { id: string }; relationType: string }>;
  }>(versionUrl);
  if (versionRes.status === 'unavailable') return { value: null, status: 'unavailable' };
  const versionData = versionRes.value;

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

  // No source repo → legitimately no scorecard (not a failure).
  if (!projectId) return { value: null, status: 'ok' };

  // 4. Query the GetProject endpoint for scorecard
  const projectUrl = `${BASE}/projects/${encodeURIComponent(projectId)}`;
  const projRes = await fetchJson<{
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
  if (projRes.status === 'unavailable') return { value: null, status: 'unavailable' };

  const scorecard = projRes.value?.scorecard;
  if (!scorecard) return { value: null, status: 'ok' };

  return {
    value: {
      date: scorecard.date,
      overallScore: scorecard.overallScore,
      projectUrl,
      checks: scorecard.checks,
    },
    status: 'ok',
  };
}

/**
 * Build deps.dev URL for a package
 */
export function depsDevUrl(system: string, name: string, version?: string): string {
  const base = `https://deps.dev/${system.toLowerCase()}/${encodeURIComponent(name)}`;
  return version ? `${base}/${encodeURIComponent(version)}` : base;
}
