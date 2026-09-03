import { describe, expect, it } from 'vitest';
import { policyDigest } from '../../src/core/policy-ref.js';
import type { Policy } from '../../src/types.js';

const policy: Policy = {
  organizationName: 'Test',
  blockedLicenses: ['GPL-3.0-only'],
  minScorecardScore: 4,
  blockVulnerabilities: true,
  minBlockingSeverity: 'MEDIUM',
  blockDeprecated: true,
  blockTyposquats: true,
  exceptionFormUrl: '',
};

describe('policyDigest', () => {
  it('is stable for semantically identical objects with different key order', () => {
    const reordered = {
      exceptionFormUrl: '',
      blockTyposquats: true,
      blockDeprecated: true,
      minBlockingSeverity: 'MEDIUM',
      blockVulnerabilities: true,
      minScorecardScore: 4,
      blockedLicenses: ['GPL-3.0-only'],
      organizationName: 'Test',
    } as Policy;

    expect(policyDigest(reordered)).toBe(policyDigest(policy));
    expect(policyDigest(policy)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('changes when an enforcement-relevant policy value changes', () => {
    expect(policyDigest({ ...policy, minBlockingSeverity: 'HIGH' }))
      .not.toBe(policyDigest(policy));
  });

  it('normalizes blocked-license ordering because policy meaning is unchanged', () => {
    const a = { ...policy, blockedLicenses: ['AGPL-3.0-only', 'GPL-3.0-only'] };
    const b = { ...policy, blockedLicenses: ['GPL-3.0-only', 'AGPL-3.0-only'] };
    expect(policyDigest(a)).toBe(policyDigest(b));
  });
});
