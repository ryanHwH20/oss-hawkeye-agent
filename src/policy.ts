import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import type { Policy, BlockingSeverity } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Coerce a configured severity into a valid threshold; defaults to MEDIUM. */
function normalizeSeverity(value: unknown): BlockingSeverity {
  const s = String(value ?? '').toUpperCase();
  return s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM' || s === 'LOW' ? s : 'MEDIUM';
}

export function loadPolicy(): Policy {
  // 1. Try to load .audit-agent.yaml from current working directory
  const yamlPath = resolve(process.cwd(), '.audit-agent.yaml');
  if (existsSync(yamlPath)) {
    try {
      const raw = readFileSync(yamlPath, 'utf-8');
      const data = yaml.parse(raw);
      if (data) {
        return {
          organizationName: data.organizationName ?? 'Workspace Policy',
          blockedLicenses: data.blockedLicenses ?? [],
          minScorecardScore: data.minScorecardScore ?? 4,
          blockVulnerabilities: data.blockVulnerabilities ?? true,
          minBlockingSeverity: normalizeSeverity(data.minBlockingSeverity),
          blockDeprecated: data.blockDeprecated ?? true,
          exceptionFormUrl: data.exceptionFormUrl ?? '',
          ai: data.ai ?? null,
        };
      }
    } catch (e) {
      console.warn(`[WARN] Failed to parse .audit-agent.yaml:`, e);
    }
  }

  // 2. Fallback to default policy.json
  const policyPath = resolve(__dirname, '..', 'policy.json');
  const raw = readFileSync(policyPath, 'utf-8');
  const data = JSON.parse(raw);

  return {
    organizationName: data.organizationName ?? 'Unknown',
    blockedLicenses: data.blockedLicenses ?? [],
    minScorecardScore: data.minScorecardScore ?? 4,
    blockVulnerabilities: data.blockVulnerabilities ?? true,
    minBlockingSeverity: normalizeSeverity(data.minBlockingSeverity),
    blockDeprecated: data.blockDeprecated ?? true,
    exceptionFormUrl: data.exceptionFormUrl ?? '',
    ai: data.ai ?? null,
  };
}
