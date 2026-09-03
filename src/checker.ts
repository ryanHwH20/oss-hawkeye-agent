import { assessPackage } from './runtime/assess-package.js';
import type { CheckResult, Policy } from './types.js';

/**
 * Backward-compatible package checker. Evidence acquisition and policy
 * evaluation now live behind assessPackage so every consumer shares the same
 * Decision Kernel without changing the established CheckResult contract.
 */
export async function checkPackage(
  ecosystem: string,
  packageName: string,
  version: string | undefined,
  policy: Policy,
): Promise<CheckResult> {
  const assessment = await assessPackage(
    { system: ecosystem, name: packageName, ...(version ? { version } : {}) },
    policy,
  );
  return assessment.result;
}

/** Check multiple packages in parallel, preserving input order. */
export async function checkPackages(
  packages: Array<{ system: string; name: string; version: string }>,
  policy: Policy,
): Promise<CheckResult[]> {
  return Promise.all(
    packages.map(pkg => checkPackage(pkg.system, pkg.name, pkg.version || undefined, policy)),
  );
}
