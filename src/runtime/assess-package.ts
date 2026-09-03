import { evaluatePackage } from '../core/evaluate-package.js';
import type { PackageEvidence, PackageEvidenceRequest } from '../evidence/package-evidence.js';
import type { CheckResult, Policy } from '../types.js';
import {
  collectPackageEvidence,
  type CollectPackageEvidenceOptions,
} from './collect-package-evidence.js';

export interface PackageAssessment {
  evidence: PackageEvidence;
  result: CheckResult;
}

/** Compose evidence acquisition with the deterministic Decision Kernel. */
export async function assessPackage(
  request: PackageEvidenceRequest,
  policy: Policy,
  options: CollectPackageEvidenceOptions = {},
): Promise<PackageAssessment> {
  const evidence = await collectPackageEvidence(request, options);
  return { evidence, result: evaluatePackage(evidence, policy) };
}
