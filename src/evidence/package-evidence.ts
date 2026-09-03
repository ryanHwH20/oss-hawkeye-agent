import type { EvidenceStatus, EvidenceTrust, EvidenceType } from '../core/evidence.js';
import type { PackageCoordinate } from '../core/intent.js';
import type {
  DepsDevDependency,
  DepsDevDepsResponse,
  DepsDevScorecardResponse,
  DepsDevVersionInfo,
  OsvVuln,
} from '../types.js';
import type { TyposquatHit } from '../util/typosquat.js';

export interface EvidenceProvenance {
  provider: string;
  fetchedAt: string;
  cached?: boolean;
}

/** Evidence payload plus acquisition metadata, before policy interpretation. */
export interface CollectedEvidence<T> {
  type: EvidenceType;
  source: string;
  trust: EvidenceTrust;
  status: EvidenceStatus;
  provenance: EvidenceProvenance;
  payload: T;
}

export interface DependencyPackageEvidence {
  nodeId: number;
  dependency: DepsDevDependency;
  metadata: CollectedEvidence<DepsDevVersionInfo | null>;
  scorecard: CollectedEvidence<DepsDevScorecardResponse | null>;
  vulnerabilities: CollectedEvidence<OsvVuln[]>;
}

export interface PackageEvidence {
  schemaVersion: 1;
  subject: PackageCoordinate;
  collectedAt: string;
  metadata: CollectedEvidence<DepsDevVersionInfo | null>;
  dependencyGraph: CollectedEvidence<DepsDevDepsResponse | null>;
  vulnerabilities: CollectedEvidence<OsvVuln[]>;
  scorecard: CollectedEvidence<DepsDevScorecardResponse | null>;
  dependencies: DependencyPackageEvidence[];
  typosquat: CollectedEvidence<TyposquatHit | null>;
  links: {
    depsDev: string;
    osv: string;
    scorecard: string | null;
  };
}

export interface PackageEvidenceRequest {
  system: string;
  name: string;
  version?: string;
}
