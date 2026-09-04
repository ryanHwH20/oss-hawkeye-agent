import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPolicyWithMetadata } from '../../src/policy.js';

describe('bundled policy fallback', () => {
  it('loads an adapter-supplied fallback without changing workspace precedence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hawkeye-policy-bundle-'));
    const fallback = join(dir, 'packaged-policy.json');
    writeFileSync(fallback, JSON.stringify({
      organizationName: 'Packaged Policy',
      blockedLicenses: ['GPL-3.0-only'],
      minBlockingSeverity: 'HIGH',
    }));

    const loaded = loadPolicyWithMetadata(dir, fallback);

    expect(loaded.source).toEqual({ kind: 'default', path: fallback });
    expect(loaded.policy).toMatchObject({
      organizationName: 'Packaged Policy',
      blockedLicenses: ['GPL-3.0-only'],
      minBlockingSeverity: 'HIGH',
    });
    expect(loaded.ref.digest).toMatch(/^sha256:/);
  });
});
