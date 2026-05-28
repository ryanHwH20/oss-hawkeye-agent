// ─── Core Types ──────────────────────────────────────────────────────────────

export interface Policy {
  organizationName: string;
  blockedLicenses: string[];
  minScorecardScore: number;
  blockVulnerabilities: boolean;
  blockDeprecated: boolean;
  exceptionFormUrl: string;
  alternatives: Record<string, AlternativeDef[]>;
  ai?: { type: string; model?: string };
}

export interface AlternativeDef {
  name: string;
  reason: string;
}

export interface OsvVuln {
  id: string;
  url: string;
  summary: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  aliases: string[];
  fixedVersions: string[];
}

export interface ScorecardCheck {
  name: string;
  score: number;
  documentation: { shortDescription: string };
}

export interface DepLicense {
  name: string;
  version: string;
  licenses: string[];
  flagged: string[];
  relation: 'SELF' | 'DIRECT' | 'INDIRECT';
}

export interface Violation {
  type: 'LICENSE' | 'VULNERABILITY' | 'SCORECARD' | 'SBOM_LICENSE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  details: string[];
  riskExplanation: string;
  affectedDep?: string;
}

export interface Alternative {
  name: string;
  version: string;
  licenses: string[];
  advisoryCount: number;
  depsDevUrl: string;
  reason: string;
  source: 'policy' | 'ai';
}

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
  alternatives: Alternative[];
  depsDevUrl: string;
}

// ─── deps.dev API response types ─────────────────────────────────────────────

export interface DepsDevVersionInfo {
  versionKey: { system: string; name: string; version: string };
  licenses: string[];
  advisoryCount?: number;
  isDefault?: boolean;
  links?: Array<{ label: string; url: string }>;
}

export interface DepsDevDependency {
  versionKey: { system: string; name: string; version: string };
  relation: 'SELF' | 'DIRECT' | 'INDIRECT';
  licenses?: string[];
}

export interface DepsDevDepsResponse {
  nodes: DepsDevDependency[];
}

export interface DepsDevScorecardResponse {
  date: string;
  overallScore: number;
  checks: Array<{
    name: string;
    score: number;
    documentation: { shortDescription: string };
  }>;
}
