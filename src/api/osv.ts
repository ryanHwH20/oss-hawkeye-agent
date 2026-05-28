import type { OsvVuln } from '../types.js';

const OSV_API = 'https://api.osv.dev/v1';

interface OsvQueryResponse {
  vulns?: Array<{
    id: string;
    summary?: string;
    details?: string;
    aliases?: string[];
    severity?: Array<{ type: string; score: string }>;
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

function extractSeverity(vuln: OsvVulnEntry): OsvVuln['severity'] {
  if (!vuln.severity?.length) return 'UNKNOWN';
  for (const s of vuln.severity) {
    const score = parseFloat(s.score);
    if (!isNaN(score)) {
      if (score >= 9.0) return 'CRITICAL';
      if (score >= 7.0) return 'HIGH';
      if (score >= 4.0) return 'MEDIUM';
      return 'LOW';
    }
  }
  return 'UNKNOWN';
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
 * Query OSV for vulnerabilities affecting a specific package version
 */
export async function queryVulnerabilities(
  ecosystem: string,
  packageName: string,
  version: string
): Promise<OsvVuln[]> {
  // Map our system names to OSV ecosystem names
  const ecosystemMap: Record<string, string> = {
    NPM: 'npm',
    PYPI: 'PyPI',
    CARGO: 'crates.io',
    GO: 'Go',
    RUBYGEMS: 'RubyGems',
    NUGET: 'NuGet',
    MAVEN: 'Maven',
  };

  const osvEcosystem = ecosystemMap[ecosystem.toUpperCase()] ?? ecosystem;

  try {
    const res = await fetch(`${OSV_API}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        package: { name: packageName, ecosystem: osvEcosystem },
      }),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as OsvQueryResponse;
    if (!data.vulns?.length) return [];

    return data.vulns.map((v) => ({
      id: v.id,
      url: `https://osv.dev/vulnerability/${v.id}`,
      summary: v.summary ?? v.details?.slice(0, 120) ?? v.id,
      severity: extractSeverity(v),
      aliases: v.aliases ?? [],
      fixedVersions: extractFixedVersions(v),
    }));
  } catch {
    return [];
  }
}
