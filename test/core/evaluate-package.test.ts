import { describe, expect, it } from 'vitest';
import { evaluatePackage } from '../../src/core/evaluate-package.js';
import type { CollectedEvidence, PackageEvidence } from '../../src/evidence/package-evidence.js';
import type { EvidenceStatus, EvidenceTrust, EvidenceType } from '../../src/core/evidence.js';
import type { OsvVuln, Policy } from '../../src/types.js';

const policy: Policy = {
  organizationName: 'Kernel test', blockedLicenses: ['GPL-3.0-only'], minScorecardScore: 4,
  blockVulnerabilities: true, minBlockingSeverity: 'MEDIUM', blockDeprecated: true,
  blockTyposquats: true, exceptionFormUrl: '',
};

function record<T>(
  type: EvidenceType,
  payload: T,
  status: EvidenceStatus = 'available',
  trust: EvidenceTrust = 'authoritative',
): CollectedEvidence<T> {
  return {
    type, source: type === 'vulnerability' ? 'osv' : 'deps.dev', trust, status,
    provenance: { provider: type === 'vulnerability' ? 'osv' : 'deps.dev', fetchedAt: '2026-09-03T02:00:00.000Z' },
    payload,
  };
}

function packageEvidence(overrides: Partial<PackageEvidence> = {}): PackageEvidence {
  const evidence: PackageEvidence = {
    schemaVersion: 1,
    subject: { system: 'NPM', name: 'root', requestedVersion: '1.0.0', resolvedVersion: '1.0.0' },
    collectedAt: '2026-09-03T02:00:00.000Z',
    metadata: record('license', {
      versionKey: { system: 'NPM', name: 'root', version: '1.0.0' }, licenses: ['MIT'],
    }),
    dependencyGraph: record('dependency', {
      nodes: [{ versionKey: { system: 'NPM', name: 'root', version: '1.0.0' }, relation: 'SELF' }],
      edges: [],
    }),
    vulnerabilities: record('vulnerability', []),
    scorecard: record('scorecard', null),
    dependencies: [],
    typosquat: record('typosquat', null, 'available', 'heuristic'),
    links: {
      depsDev: 'https://deps.dev/npm/root/1.0.0',
      osv: 'https://osv.dev/list?q=root',
      scorecard: null,
    },
  };
  return { ...evidence, ...overrides };
}

const malware: OsvVuln = {
  id: 'MAL-2026-1', url: 'https://osv.dev/vulnerability/MAL-2026-1', summary: 'malware',
  severity: 'UNKNOWN', cvssScore: null, aliases: [], fixedVersions: [], malicious: true,
};

const highVulnerability: OsvVuln = {
  id: 'GHSA-test', url: 'https://osv.dev/vulnerability/GHSA-test', summary: 'high',
  severity: 'HIGH', cvssScore: 8, aliases: ['CVE-2026-0001'], fixedVersions: ['2.0.0'],
};

describe('evaluatePackage Decision Kernel', () => {
  it('is deterministic and does not mutate evidence or policy', () => {
    const evidence = packageEvidence();
    const evidenceBefore = structuredClone(evidence);
    const policyBefore = structuredClone(policy);

    const first = evaluatePackage(evidence, policy);
    const second = evaluatePackage(evidence, policy);

    expect(second).toEqual(first);
    expect(evidence).toEqual(evidenceBefore);
    expect(policy).toEqual(policyBefore);
  });

  it('replays the same evidence under a different policy without recollection', () => {
    const evidence = packageEvidence();

    expect(evaluatePackage(evidence, policy).verdict).toBe('SAFE');
    const blocked = evaluatePackage(evidence, { ...policy, blockedLicenses: ['MIT'] });
    expect(blocked.verdict).toBe('BLOCKED');
    expect(blocked.violations[0].type).toBe('LICENSE');
  });

  it('fails closed for critical evidence outages but keeps Scorecard unavailable advisory-only', () => {
    const osvDown = packageEvidence({ vulnerabilities: record('vulnerability', [], 'unavailable') });
    const scorecardDown = packageEvidence({ scorecard: record('scorecard', null, 'unavailable') });

    expect(evaluatePackage(osvDown, policy)).toMatchObject({
      verdict: 'UNKNOWN', unverified: ['Vulnerabilities (OSV)'],
    });
    expect(evaluatePackage(scorecardDown, policy)).toMatchObject({
      verdict: 'SAFE', unverified: ['OpenSSF Scorecard (deps.dev)'],
    });
  });

  it('distinguishes an authoritative missing package from a retryable source outage', () => {
    const missing = packageEvidence({ metadata: record('license', null, 'not_found') });
    const unavailable = packageEvidence({ metadata: record('license', null, 'unavailable') });

    expect(evaluatePackage(missing, policy)).toMatchObject({
      verdict: 'UNKNOWN', unverified: ['Package not found on deps.dev (no metadata to audit)'],
    });
    expect(evaluatePackage(unavailable, policy)).toMatchObject({
      verdict: 'UNKNOWN', unverified: ['Package metadata & licenses (deps.dev)'],
    });
  });

  it('blocks root malware even when ordinary vulnerability blocking is disabled', () => {
    const evidence = packageEvidence({ vulnerabilities: record('vulnerability', [malware]) });
    const result = evaluatePackage(evidence, {
      ...policy, blockVulnerabilities: false, minBlockingSeverity: 'CRITICAL',
    });

    expect(result.verdict).toBe('BLOCKED');
    expect(result.violations.map(item => item.type)).toEqual(['MALWARE']);
  });

  it('blocks transitive malware but not an ordinary transitive vulnerability when the toggle is off', () => {
    const graph = {
      nodes: [
        { versionKey: { system: 'NPM', name: 'root', version: '1.0.0' }, relation: 'SELF' as const },
        { versionKey: { system: 'NPM', name: 'child', version: '2.0.0' }, relation: 'DIRECT' as const },
      ],
      edges: [{ fromNode: 0, toNode: 1, requirement: '^2.0.0' }],
    };
    const dependency = {
      nodeId: 1,
      dependency: graph.nodes[1],
      metadata: record('license', {
        versionKey: graph.nodes[1].versionKey, licenses: ['MIT'],
      }),
      scorecard: record('scorecard', null),
      vulnerabilities: record('vulnerability', [malware, highVulnerability]),
    };
    const evidence = packageEvidence({
      dependencyGraph: record('dependency', graph), dependencies: [dependency],
    });
    const result = evaluatePackage(evidence, { ...policy, blockVulnerabilities: false });

    expect(result.verdict).toBe('BLOCKED');
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'MALWARE', affectedDep: 'child@2.0.0', path: ['root@1.0.0', 'child@2.0.0'],
    }));
    expect(result.violations.some(item => item.type === 'SBOM_VULNERABILITY')).toBe(false);
  });

  it('keeps typosquat evidence separate from its policy effect', () => {
    const evidence = packageEvidence({
      subject: { system: 'NPM', name: 'expres', requestedVersion: '1.0.0', resolvedVersion: '1.0.0' },
      typosquat: record('typosquat', { nearest: 'express', kind: 'edit' }, 'available', 'heuristic'),
    });

    expect(evaluatePackage(evidence, policy).verdict).toBe('BLOCKED');
    expect(evaluatePackage(evidence, { ...policy, blockTyposquats: false }).verdict).toBe('SAFE');
  });
});
