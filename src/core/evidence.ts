import type { PackageCoordinate } from './intent.js';

export type EvidenceType =
  | 'vulnerability'
  | 'malware'
  | 'license'
  | 'dependency'
  | 'scorecard'
  | 'typosquat'
  | 'source_failure';

export type EvidenceTrust = 'authoritative' | 'heuristic' | 'asserted';
export type EvidenceStatus = 'available' | 'unavailable' | 'not_found' | 'unsupported';

/** A lightweight evidence reference suitable for agent transports. */
export interface EvidenceRef {
  id: string;
  subject: PackageCoordinate;
  type: EvidenceType;
  source: string;
  trust: EvidenceTrust;
  status: EvidenceStatus;
  uri?: string;
}
