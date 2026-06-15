// ─── Core Types ──────────────────────────────────────────────────────────────

/** Severities that can be configured as the minimum blocking threshold. */
export type BlockingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Policy {
  organizationName: string;
  blockedLicenses: string[];
  minScorecardScore: number;
  blockVulnerabilities: boolean;
  /** Lowest vulnerability severity that blocks a package. Default: MEDIUM. */
  minBlockingSeverity: BlockingSeverity;
  blockDeprecated: boolean;
  exceptionFormUrl: string;
  ai?: { type: string; model?: string };
}

export interface OsvVuln {
  id: string;
  url: string;
  summary: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  cvssScore: number | null;
  aliases: string[];
  fixedVersions: string[];
}

export type ScorecardOfficialSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Unknown';

export interface ScorecardCheck {
  name: string;
  score: number;
  officialSeverity: ScorecardOfficialSeverity;
  documentation: { shortDescription: string; url?: string };
}

export interface DepLicense {
  name: string;
  version: string;
  licenses: string[];
  flagged: string[];
  relation: 'SELF' | 'DIRECT' | 'INDIRECT';
  scorecardScore?: number | null;
  path?: string[]; // Topology path from root
}

export interface Violation {
  type: 'LICENSE' | 'VULNERABILITY' | 'SCORECARD' | 'SBOM_LICENSE' | 'SBOM_VULNERABILITY';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  details: string[];
  riskExplanation: string;
  affectedDep?: string;
  path?: string[];
  fixedVersions?: string[];
}

// ─── Data-source availability (fail-closed support) ─────────────────────────

/**
 * Whether an external data source was successfully consulted.
 * `unavailable` means the source could not be reached (network error, rate
 * limit, server error) — NOT that it returned an empty/negative answer.
 */
export type SourceStatus = 'ok' | 'unavailable';

/** A fetched value paired with whether its source was actually reachable. */
export interface SourceResult<T> {
  value: T;
  status: SourceStatus;
}

/**
 * The overall audit verdict.
 * - SAFE: every relevant source was consulted and nothing blocks the package.
 * - BLOCKED: a policy violation was found.
 * - UNKNOWN: a critical source could not be reached, so safety is unverifiable.
 *   Treated as fail-closed (non-zero exit), never silently approved.
 */
export type Verdict = 'SAFE' | 'BLOCKED' | 'UNKNOWN';

export interface CheckResult {
  name: string;
  version: string;
  system: string;
  licenses: string[];
  rootFlaggedLicenses: string[];
  advisoryCount: number;
  vulnerabilities: OsvVuln[];
  osvScannerUsed: boolean;
  scorecardScore: number | null;
  scorecardDate: string | null;
  scorecardChecks: ScorecardCheck[];
  depCount: { direct: number; indirect: number };
  depLicenses: DepLicense[];
  violations: Violation[];
  verdict: Verdict;
  /** Human-readable names of data sources that could not be verified. */
  unverified: string[];
  depsDevUrl: string;
  osvQueryUrl: string;
  scorecardSourceUrl: string | null;
}

// ─── deps.dev API response types ─────────────────────────────────────────────

export interface DepsDevVersionInfo {
  versionKey: { system: string; name: string; version: string };
  licenses: string[];
  advisoryKeys?: Array<{ id: string }>; // OSV advisory IDs
  advisoryCount?: number;
  isDefault?: boolean;
  links?: Array<{ label: string; url: string }>;
  relatedProjects?: Array<{ projectKey: { id: string }; relationType: string }>;
}

export interface DepsDevDependency {
  versionKey: { system: string; name: string; version: string };
  relation: 'SELF' | 'DIRECT' | 'INDIRECT';
  licenses?: string[];
}

export interface DepsDevDepsResponse {
  nodes: DepsDevDependency[];
  edges: Array<{ fromNode: number; toNode: number; requirement: string }>;
}

export interface DepsDevScorecardResponse {
  date: string;
  overallScore: number;
  projectUrl: string;
  checks: Array<{
    name: string;
    score: number;
    reason: string;
    documentation: { shortDescription: string; url?: string };
  }>;
}
