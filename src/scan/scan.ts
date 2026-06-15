import type { CheckResult, Policy, Verdict } from '../types.js';
import { checkPackage } from '../checker.js';
import { mapLimit } from '../util/concurrency.js';
import { detectManifests } from './manifests.js';

// Each checkPackage already bounds its own internal fan-out, so the top-level
// scan runs only a few packages at a time to avoid multiplying the load.
const SCAN_CONCURRENCY = 5;

export interface ScanReport {
  path: string;
  manifests: string[];
  results: CheckResult[];
  verdict: Verdict;
}

/**
 * Audit every direct dependency declared by the manifests in `dir` and
 * aggregate into a single verdict. BLOCKED dominates; otherwise any UNKNOWN
 * makes the whole scan UNKNOWN (fail-closed); only an all-clear scan is SAFE.
 */
export async function scanProject(dir: string, policy: Policy): Promise<ScanReport> {
  const manifests = detectManifests(dir);

  // De-duplicate identical coordinates that appear in more than one manifest.
  const seen = new Set<string>();
  const deps = manifests
    .flatMap(m => m.dependencies)
    .filter(d => {
      const key = `${d.ecosystem}|${d.name}|${d.version ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const results = await mapLimit(deps, SCAN_CONCURRENCY, d =>
    checkPackage(d.ecosystem, d.name, d.version, policy)
  );

  const verdict: Verdict = results.some(r => r.verdict === 'BLOCKED')
    ? 'BLOCKED'
    : results.some(r => r.verdict === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'SAFE';

  return { path: dir, manifests: manifests.map(m => m.file), results, verdict };
}
