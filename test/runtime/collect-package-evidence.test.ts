import { describe, expect, it, vi } from 'vitest';
import type { PackageEvidenceProviders } from '../../src/runtime/collect-package-evidence.js';
import { collectPackageEvidence } from '../../src/runtime/collect-package-evidence.js';
import type { OsvVuln } from '../../src/types.js';

const fixedNow = () => new Date('2026-09-03T02:00:00.000Z');

function cleanProviders(system = 'NPM', name = 'root', version = '1.0.0') {
  const getVersionInfo = vi.fn(async (_system: string, packageName: string, packageVersion?: string) => ({
    status: 'ok' as const,
    value: {
      versionKey: { system, name: packageName, version: packageVersion ?? version },
      licenses: ['MIT'],
    },
  }));
  const providers = {
    getVersionInfo,
    getDependencies: vi.fn(async () => ({
      status: 'ok' as const,
      value: {
        nodes: [{ versionKey: { system, name, version }, relation: 'SELF' as const }],
        edges: [],
      },
    })),
    getProjectScorecard: vi.fn(async () => ({ status: 'ok' as const, value: null })),
    queryVulnerabilities: vi.fn(async () => ({ status: 'ok' as const, value: [] })),
    queryVulnerabilitiesBatch: vi.fn(async () => ({ status: 'ok' as const, value: [] })),
    detectTyposquat: vi.fn(() => null),
  } as unknown as PackageEvidenceProviders;
  return { providers, getVersionInfo };
}

const ecosystems = [
  ['NPM', 'is-number', '7.0.0'],
  ['PYPI', 'idna', '3.7'],
  ['CARGO', 'itoa', '1.0.11'],
  ['GO', 'github.com/google/uuid', 'v1.6.0'],
  ['RUBYGEMS', 'rake', '13.2.1'],
  ['NUGET', 'Newtonsoft.Json', '13.0.3'],
  ['MAVEN', 'org.slf4j:slf4j-api', '2.0.13'],
] as const;

describe('collectPackageEvidence', () => {
  it.each(ecosystems)('preserves the %s package coordinate', async (system, name, version) => {
    const { providers, getVersionInfo } = cleanProviders(system, name, version);

    const evidence = await collectPackageEvidence(
      { system, name, version },
      { providers, now: fixedNow },
    );

    expect(evidence.subject).toEqual({
      system, name, requestedVersion: version, resolvedVersion: version,
    });
    expect(evidence.collectedAt).toBe('2026-09-03T02:00:00.000Z');
    expect(getVersionInfo).toHaveBeenCalledWith(system, name, version);
    expect(evidence.metadata.provenance).toEqual({
      provider: 'deps.dev', fetchedAt: evidence.collectedAt,
    });
    expect(evidence).not.toHaveProperty('verdict');
  });

  it('normalizes dependency evidence and always queries advisory-bearing dependencies', async () => {
    const malware: OsvVuln = {
      id: 'MAL-2026-1', url: 'https://osv.dev/MAL-2026-1', summary: 'malware',
      severity: 'UNKNOWN', cvssScore: null, aliases: [], fixedVersions: [], malicious: true,
    };
    const getVersionInfo = vi.fn(async (_system: string, packageName: string) => ({
      status: 'ok' as const,
      value: packageName === 'root'
        ? {
            versionKey: { system: 'NPM', name: 'root', version: '1.0.0' },
            licenses: ['MIT'],
            relatedProjects: [{ projectKey: { id: 'github.com/acme/root' }, relationType: 'SOURCE_REPO' }],
          }
        : {
            versionKey: { system: 'NPM', name: 'child', version: '2.0.0' },
            licenses: ['Apache-2.0'], advisoryKeys: [{ id: malware.id }],
          },
    }));
    const queryVulnerabilitiesBatch = vi.fn(async () => ({ status: 'ok' as const, value: [[malware]] }));
    const providers = {
      getVersionInfo,
      getDependencies: vi.fn(async () => ({
        status: 'ok' as const,
        value: {
          nodes: [
            { versionKey: { system: 'NPM', name: 'root', version: '1.0.0' }, relation: 'SELF' as const },
            { versionKey: { system: 'NPM', name: 'child', version: '2.0.0' }, relation: 'DIRECT' as const },
          ],
          edges: [{ fromNode: 0, toNode: 1, requirement: '^2.0.0' }],
        },
      })),
      getProjectScorecard: vi.fn(async () => ({ status: 'ok' as const, value: null })),
      queryVulnerabilities: vi.fn(async () => ({ status: 'ok' as const, value: [] })),
      queryVulnerabilitiesBatch,
      detectTyposquat: vi.fn(() => null),
    } as unknown as PackageEvidenceProviders;

    const evidence = await collectPackageEvidence(
      { system: 'NPM', name: 'root', version: '1.0.0' },
      { providers, now: fixedNow },
    );

    expect(queryVulnerabilitiesBatch).toHaveBeenCalledWith([{
      ecosystem: 'NPM', name: 'child', version: '2.0.0',
    }]);
    expect(evidence.dependencies[0]).toMatchObject({
      nodeId: 1,
      dependency: { versionKey: { name: 'child', version: '2.0.0' }, relation: 'DIRECT' },
      metadata: { status: 'available', payload: { licenses: ['Apache-2.0'] } },
      vulnerabilities: { status: 'available', payload: [malware] },
    });
  });

  it('distinguishes authoritative not-found from provider unavailability', async () => {
    const unavailable = cleanProviders().providers;
    unavailable.getVersionInfo = vi.fn(async () => ({ status: 'unavailable' as const, value: null }));
    const missing = cleanProviders().providers;
    missing.getVersionInfo = vi.fn(async () => ({ status: 'ok' as const, value: null }));

    const unavailableEvidence = await collectPackageEvidence(
      { system: 'NPM', name: 'root', version: '1.0.0' },
      { providers: unavailable, now: fixedNow },
    );
    const missingEvidence = await collectPackageEvidence(
      { system: 'NPM', name: 'root', version: '1.0.0' },
      { providers: missing, now: fixedNow },
    );

    expect(unavailableEvidence.metadata.status).toBe('unavailable');
    expect(missingEvidence.metadata.status).toBe('not_found');
  });
});
