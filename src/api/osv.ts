import type { OsvVuln, SourceResult } from '../types.js';
import { resilientFetch } from './http.js';
import { mapLimit } from '../util/concurrency.js';
import cvss from 'cvss';

const OSV_API = 'https://api.osv.dev/v1';

// How many vulnerability-detail hydrations to run at once.
const HYDRATE_CONCURRENCY = 8;

// Map our system names to OSV ecosystem names.
const ECOSYSTEM_MAP: Record<string, string> = {
  NPM: 'npm',
  PYPI: 'PyPI',
  CARGO: 'crates.io',
  GO: 'Go',
  RUBYGEMS: 'RubyGems',
  NUGET: 'NuGet',
  MAVEN: 'Maven',
};

function osvEcosystem(ecosystem: string): string {
  return ECOSYSTEM_MAP[ecosystem.toUpperCase()] ?? ecosystem;
}

interface OsvQueryResponse {
  vulns?: Array<{
    id: string;
    summary?: string;
    details?: string;
    aliases?: string[];
    severity?: Array<{ type: string; score: string }>;
    database_specific?: { severity?: string; [key: string]: unknown };
    affected?: Array<{
      ranges?: Array<{
        type: string;
        events: Array<{ introduced?: string; fixed?: string }>;
      }>;
    }>;
    references?: Array<{ type: string; url: string }>;
  }>;
}

type OsvVulnEntry = NonNullable<OsvQueryResponse['vulns']>[number];

interface SeverityResult {
  level: OsvVuln['severity'];
  score: number | null;
}

export function extractSeverity(vuln: OsvVulnEntry): SeverityResult {
  let score: number | null = null;
  let level: OsvVuln['severity'] = 'UNKNOWN';

  // 1. Parse CVSS vector string
  if (vuln.severity?.length) {
    for (const s of vuln.severity) {
      if (s.type === 'CVSS_V3' || s.type === 'CVSS_V2') {
        const rawVector = s.score;
        // The cvss library handles 3.0, but 3.1 is mathematically identical
        const compatibleVector = rawVector.replace('CVSS:3.1', 'CVSS:3.0');
        const calcScore = cvss.getScore(compatibleVector);
        if (typeof calcScore === 'number' && !isNaN(calcScore) && calcScore > 0) {
          score = calcScore;
          break;
        }
      }
    }
  }

  // 2. Map score to standard severity level
  if (score !== null) {
    if (score >= 9.0) level = 'CRITICAL';
    else if (score >= 7.0) level = 'HIGH';
    else if (score >= 4.0) level = 'MEDIUM';
    else level = 'LOW';
    return { level, score };
  }

  // 3. Fallback to database_specific severity string
  if (vuln.database_specific?.severity) {
    const s = vuln.database_specific.severity.toUpperCase();
    if (s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM' || s === 'LOW') {
      return { level: s as OsvVuln['severity'], score: null };
    }
  }

  return { level: 'UNKNOWN', score: null };
}

function extractFixedVersions(vuln: OsvVulnEntry): string[] {
  const fixed: string[] = [];
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events) {
        if (event.fixed) fixed.push(event.fixed);
      }
    }
  }
  return [...new Set(fixed)];
}

/**
 * Whether an OSV advisory marks the package itself as malicious (malware /
 * backdoor), as opposed to a vulnerability in legitimate code. OSV aggregates
 * the OSSF malicious-packages feed under `MAL-*` IDs; some sources also tag it
 * in `database_specific`. Malware often carries no CVSS, so it must be detected
 * by provenance, not severity.
 */
function isMalicious(v: OsvVulnEntry): boolean {
  const ids = [v.id, ...(v.aliases ?? [])];
  if (ids.some(id => typeof id === 'string' && /^MAL-/i.test(id))) return true;
  const ds = v.database_specific as { malicious?: unknown; type?: unknown } | undefined;
  if (ds?.malicious === true) return true;
  return typeof ds?.type === 'string' && ds.type.toUpperCase() === 'MALWARE';
}

/** Convert a raw OSV vulnerability record into our normalized shape. */
function mapVuln(v: OsvVulnEntry): OsvVuln {
  const { level, score } = extractSeverity(v);
  return {
    id: v.id,
    url: `https://osv.dev/vulnerability/${v.id}`,
    summary: v.summary ?? v.details?.slice(0, 120) ?? v.id,
    severity: level,
    cvssScore: score,
    aliases: v.aliases ?? [],
    fixedVersions: extractFixedVersions(v),
    malicious: isMalicious(v),
  };
}

/**
 * Query OSV for vulnerabilities affecting a specific package version.
 *
 * The returned `status` distinguishes a trustworthy "no vulnerabilities"
 * (HTTP 200 with an empty list) from "we couldn't reach OSV" (network error,
 * rate limit, or server error). Callers must NOT report a package as clean
 * when the status is 'unavailable'.
 */
export async function queryVulnerabilities(
  ecosystem: string,
  packageName: string,
  version: string
): Promise<SourceResult<OsvVuln[]>> {
  try {
    const res = await resilientFetch(`${OSV_API}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        package: { name: packageName, ecosystem: osvEcosystem(ecosystem) },
      }),
    });

    // 429 (rate limited) and 5xx (server) mean we couldn't really check.
    if (res.status === 429 || res.status >= 500) {
      return { value: [], status: 'unavailable' };
    }
    // Other non-2xx (e.g. 400 for an unknown ecosystem) is an authoritative
    // "nothing to report" rather than an outage.
    if (!res.ok) return { value: [], status: 'ok' };

    const data = (await res.json()) as OsvQueryResponse;
    if (!data.vulns?.length) return { value: [], status: 'ok' };

    return { value: data.vulns.map(mapVuln), status: 'ok' };
  } catch {
    return { value: [], status: 'unavailable' };
  }
}

export interface OsvBatchTarget {
  ecosystem: string;
  name: string;
  version: string;
}

interface OsvBatchResponse {
  results?: Array<{ vulns?: Array<{ id: string; modified?: string }> }>;
}

/**
 * Query OSV for many package versions in a single `/v1/querybatch` request,
 * then hydrate full details for the (de-duplicated) set of vulnerability IDs.
 *
 * This replaces N individual `/query` calls with 1 batch call plus a small,
 * concurrency-limited set of detail lookups — most dependencies have zero
 * vulnerabilities, so the hydration set is usually tiny.
 *
 * Returns one `OsvVuln[]` per input target, in order. `status: 'unavailable'`
 * if the batch call or any required detail lookup could not be reached, so the
 * caller can fail closed for the affected targets.
 */
export async function queryVulnerabilitiesBatch(
  targets: ReadonlyArray<OsvBatchTarget>
): Promise<SourceResult<OsvVuln[][]>> {
  if (targets.length === 0) return { value: [], status: 'ok' };

  const empty = (): OsvVuln[][] => targets.map(() => []);

  let batch: OsvBatchResponse;
  try {
    const res = await resilientFetch(`${OSV_API}/querybatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: targets.map(t => ({
          version: t.version,
          package: { name: t.name, ecosystem: osvEcosystem(t.ecosystem) },
        })),
      }),
    });
    if (res.status === 429 || res.status >= 500) return { value: empty(), status: 'unavailable' };
    if (!res.ok) return { value: empty(), status: 'ok' };
    batch = (await res.json()) as OsvBatchResponse;
  } catch {
    return { value: empty(), status: 'unavailable' };
  }

  const results = batch.results ?? [];

  // De-duplicate the vulnerability IDs across all targets before hydrating.
  const uniqueIds = [...new Set(results.flatMap(r => (r.vulns ?? []).map(v => v.id)))];

  const hydrated = new Map<string, OsvVuln>();
  let hydrateUnavailable = false;
  await mapLimit(uniqueIds, HYDRATE_CONCURRENCY, async (id) => {
    try {
      const res = await resilientFetch(`${OSV_API}/vulns/${encodeURIComponent(id)}`);
      if (res.status === 429 || res.status >= 500) { hydrateUnavailable = true; return; }
      if (!res.ok) return;
      hydrated.set(id, mapVuln((await res.json()) as OsvVulnEntry));
    } catch {
      hydrateUnavailable = true;
    }
  });

  const value = targets.map((_t, i) =>
    (results[i]?.vulns ?? [])
      .map(v => hydrated.get(v.id))
      .filter((v): v is OsvVuln => v !== undefined)
  );

  return { value, status: hydrateUnavailable ? 'unavailable' : 'ok' };
}
