import type { Violation } from '../types.js';
import type { PackageCoordinate } from './intent.js';

export type FindingEffect = 'blocking' | 'advisory';

/** A policy-relevant observation in the canonical decision contract. */
export interface Finding {
  id: string;
  subject: PackageCoordinate;
  category: Violation['type'];
  severity: Violation['severity'];
  effect: FindingEffect;
  title: string;
  details: string[];
  explanation: string;
  affectedDependency?: string;
  dependencyPath?: string[];
  fixedVersions?: string[];
}
