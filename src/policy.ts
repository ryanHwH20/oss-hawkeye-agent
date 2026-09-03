import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import type { Policy, BlockingSeverity } from './types.js';
import { policyRef, type PolicyRef } from './core/policy-ref.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Coerce a configured severity into a valid threshold; defaults to MEDIUM. */
function normalizeSeverity(value: unknown): BlockingSeverity {
  const s = String(value ?? '').toUpperCase();
  return s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM' || s === 'LOW' ? s : 'MEDIUM';
}

export interface LoadedPolicy {
  policy: Policy;
  ref: PolicyRef;
  source: { kind: 'workspace' | 'default'; path: string };
}

function fromData(data: Record<string, unknown>, fallbackName: string): Policy {
  return {
    organizationName: String(data.organizationName ?? fallbackName),
    blockedLicenses: Array.isArray(data.blockedLicenses) ? data.blockedLicenses.map(String) : [],
    minScorecardScore: typeof data.minScorecardScore === 'number' ? data.minScorecardScore : 4,
    blockVulnerabilities: typeof data.blockVulnerabilities === 'boolean' ? data.blockVulnerabilities : true,
    minBlockingSeverity: normalizeSeverity(data.minBlockingSeverity),
    blockDeprecated: typeof data.blockDeprecated === 'boolean' ? data.blockDeprecated : true,
    blockTyposquats: typeof data.blockTyposquats === 'boolean' ? data.blockTyposquats : true,
    exceptionFormUrl: String(data.exceptionFormUrl ?? ''),
    ai: data.ai && typeof data.ai === 'object' ? data.ai as Policy['ai'] : null,
  };
}

/** Load normalized policy plus a stable identity for audit and agent decisions. */
export function loadPolicyWithMetadata(cwd: string = process.cwd()): LoadedPolicy {
  // 1. Try to load .audit-agent.yaml from current working directory
  const yamlPath = resolve(cwd, '.audit-agent.yaml');
  if (existsSync(yamlPath)) {
    try {
      const raw = readFileSync(yamlPath, 'utf-8');
      const data = yaml.parse(raw);
      if (data && typeof data === 'object') {
        const policy = fromData(data as Record<string, unknown>, 'Workspace Policy');
        return { policy, ref: policyRef(policy), source: { kind: 'workspace', path: yamlPath } };
      }
    } catch (e) {
      console.warn(`[WARN] Failed to parse .audit-agent.yaml:`, e);
    }
  }

  // 2. Fallback to default policy.json
  const policyPath = resolve(__dirname, '..', 'policy.json');
  const raw = readFileSync(policyPath, 'utf-8');
  const data = JSON.parse(raw) as Record<string, unknown>;
  const policy = fromData(data, 'Unknown');

  return { policy, ref: policyRef(policy), source: { kind: 'default', path: policyPath } };
}

export function loadPolicy(cwd: string = process.cwd()): Policy {
  return loadPolicyWithMetadata(cwd).policy;
}
