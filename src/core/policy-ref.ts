import { createHash } from 'node:crypto';
import type { Policy } from '../types.js';

export interface PolicyRef {
  id?: string;
  digest: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

/** Digest normalized policy meaning rather than source-file formatting. */
export function policyDigest(policy: Policy): string {
  const normalized = {
    ...policy,
    blockedLicenses: [...new Set(policy.blockedLicenses)].sort(),
    blockTyposquats: policy.blockTyposquats ?? true,
    ai: policy.ai ?? null,
  };
  const json = JSON.stringify(stableValue(normalized));
  return `sha256:${createHash('sha256').update(json).digest('hex')}`;
}

export function policyRef(policy: Policy): PolicyRef {
  return { id: policy.organizationName || undefined, digest: policyDigest(policy) };
}
