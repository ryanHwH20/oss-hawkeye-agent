import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Policy } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadPolicy(): Policy {
  const policyPath = resolve(__dirname, '..', 'policy.json');
  const raw = readFileSync(policyPath, 'utf-8');
  const data = JSON.parse(raw);

  return {
    organizationName: data.organizationName ?? 'Unknown',
    blockedLicenses: data.blockedLicenses ?? [],
    minScorecardScore: data.minScorecardScore ?? 4,
    blockVulnerabilities: data.blockVulnerabilities ?? true,
    blockDeprecated: data.blockDeprecated ?? true,
    exceptionFormUrl: data.exceptionFormUrl ?? '',
    alternatives: data.alternatives ?? {},
    ai: data.ai ?? null,
  };
}
