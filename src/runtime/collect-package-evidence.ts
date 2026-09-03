import {
  depsDevUrl,
  extractSourceRepoId,
  getDependencies,
  getProjectScorecard,
  getVersionInfo,
} from '../api/deps-dev.js';
import { queryVulnerabilities, queryVulnerabilitiesBatch } from '../api/osv.js';
import type { EvidenceStatus, EvidenceTrust, EvidenceType } from '../core/evidence.js';
import type {
  CollectedEvidence,
  DependencyPackageEvidence,
  PackageEvidence,
  PackageEvidenceRequest,
} from '../evidence/package-evidence.js';
import type { SourceResult } from '../types.js';
import { mapLimit } from '../util/concurrency.js';
import { detectTyposquat } from '../util/typosquat.js';

const DEP_CONCURRENCY = 8;

const OSV_ECOSYSTEMS: Record<string, string> = {
  NPM: 'npm',
  PYPI: 'PyPI',
  CARGO: 'crates.io',
  GO: 'Go',
  RUBYGEMS: 'RubyGems',
  NUGET: 'NuGet',
  MAVEN: 'Maven',
};

export interface PackageEvidenceProviders {
  getVersionInfo: typeof getVersionInfo;
  getDependencies: typeof getDependencies;
  getProjectScorecard: typeof getProjectScorecard;
  queryVulnerabilities: typeof queryVulnerabilities;
  queryVulnerabilitiesBatch: typeof queryVulnerabilitiesBatch;
  detectTyposquat: typeof detectTyposquat;
}

export interface CollectPackageEvidenceOptions {
  providers?: PackageEvidenceProviders;
  now?: () => Date;
}

const defaultProviders: PackageEvidenceProviders = {
  getVersionInfo,
  getDependencies,
  getProjectScorecard,
  queryVulnerabilities,
  queryVulnerabilitiesBatch,
  detectTyposquat,
};

function statusOf<T>(result: SourceResult<T | null>, nullMeansNotFound = false): EvidenceStatus {
  if (result.status === 'unavailable') return 'unavailable';
  if (nullMeansNotFound && result.value === null) return 'not_found';
  return 'available';
}

function evidence<T>(
  type: EvidenceType,
  source: string,
  trust: EvidenceTrust,
  status: EvidenceStatus,
  provider: string,
  fetchedAt: string,
  payload: T,
): CollectedEvidence<T> {
  return { type, source, trust, status, provenance: { provider, fetchedAt }, payload };
}

function osvSearchUrl(system: string, name: string): string {
  const ecosystem = OSV_ECOSYSTEMS[system.toUpperCase()] ?? system;
  return `https://osv.dev/list?ecosystem=${encodeURIComponent(ecosystem)}&q=${encodeURIComponent(name)}`;
}

/**
 * Acquire and normalize package evidence. This is the side-effecting boundary:
 * it may use network-backed providers and the providers' caches, but it never
 * decides whether the package is allowed by organization policy.
 */
export async function collectPackageEvidence(
  request: PackageEvidenceRequest,
  options: CollectPackageEvidenceOptions = {},
): Promise<PackageEvidence> {
  const providers = options.providers ?? defaultProviders;
  const collectedAt = (options.now ?? (() => new Date()))().toISOString();
  const metadataResult = await providers.getVersionInfo(request.system, request.name, request.version);
  const versionInfo = metadataResult.value;
  const resolvedVersion = versionInfo?.versionKey?.version ?? request.version ?? 'latest';
  const rootProjectId = extractSourceRepoId(versionInfo);

  const [dependencyResult, scorecardResult, vulnerabilityResult] = await Promise.all([
    providers.getDependencies(request.system, request.name, resolvedVersion),
    rootProjectId
      ? providers.getProjectScorecard(rootProjectId)
      : Promise.resolve({ value: null, status: 'ok' as const }),
    providers.queryVulnerabilities(request.system, request.name, resolvedVersion),
  ]);

  const graph = dependencyResult.value;
  const allDependencies = (graph?.nodes ?? [])
    .map((dependency, nodeId) => ({ dependency, nodeId }))
    .filter(item => item.dependency.relation !== 'SELF');

  const dependencyMetadata = await mapLimit(allDependencies, DEP_CONCURRENCY, async item => {
    const metadata = await providers.getVersionInfo(
      request.system,
      item.dependency.versionKey.name,
      item.dependency.versionKey.version,
    );
    const projectId = extractSourceRepoId(metadata.value);
    const scorecard = projectId
      ? await providers.getProjectScorecard(projectId)
      : { value: null, status: 'ok' as const };
    return { ...item, metadata, scorecard };
  });

  // Malware must remain visible even when ordinary vulnerability blocking is
  // disabled, so advisory-bearing dependencies are always queried. Policy only
  // decides the effect of the evidence after collection.
  const vulnerabilityTargets = dependencyMetadata
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.metadata.value?.advisoryKeys?.length ?? 0) > 0);
  const dependencyVulnerabilities = await providers.queryVulnerabilitiesBatch(
    vulnerabilityTargets.map(({ item }) => ({
      ecosystem: request.system,
      name: item.dependency.versionKey.name,
      version: item.dependency.versionKey.version,
    })),
  );
  const vulnerabilitiesByDependency = new Map<number, typeof dependencyVulnerabilities.value[number]>();
  vulnerabilityTargets.forEach(({ index }, resultIndex) => {
    vulnerabilitiesByDependency.set(index, dependencyVulnerabilities.value[resultIndex] ?? []);
  });

  const dependencies: DependencyPackageEvidence[] = dependencyMetadata.map((item, index) => {
    const wasQueried = vulnerabilitiesByDependency.has(index);
    return {
      nodeId: item.nodeId,
      dependency: item.dependency,
      metadata: evidence(
        'license', 'deps.dev', 'authoritative', statusOf(item.metadata, true),
        'deps.dev', collectedAt, item.metadata.value,
      ),
      scorecard: evidence(
        'scorecard', 'OpenSSF Scorecard', 'authoritative', statusOf(item.scorecard),
        'deps.dev', collectedAt, item.scorecard.value,
      ),
      vulnerabilities: evidence(
        'vulnerability', 'osv', 'authoritative',
        wasQueried && dependencyVulnerabilities.status === 'unavailable' ? 'unavailable' : 'available',
        'osv', collectedAt, vulnerabilitiesByDependency.get(index) ?? [],
      ),
    };
  });

  const scorecard = scorecardResult.value;
  return {
    schemaVersion: 1,
    subject: {
      system: request.system,
      name: request.name,
      ...(request.version ? { requestedVersion: request.version } : {}),
      resolvedVersion,
    },
    collectedAt,
    metadata: evidence(
      'license', 'deps.dev', 'authoritative', statusOf(metadataResult, true),
      'deps.dev', collectedAt, versionInfo,
    ),
    dependencyGraph: evidence(
      'dependency', 'deps.dev', 'authoritative', statusOf(dependencyResult),
      'deps.dev', collectedAt, graph,
    ),
    vulnerabilities: evidence(
      'vulnerability', 'osv', 'authoritative', statusOf(vulnerabilityResult),
      'osv', collectedAt, vulnerabilityResult.value,
    ),
    scorecard: evidence(
      'scorecard', 'OpenSSF Scorecard', 'authoritative', statusOf(scorecardResult),
      'deps.dev', collectedAt, scorecard,
    ),
    dependencies,
    typosquat: evidence(
      'typosquat', 'Hawkeye', 'heuristic', 'available',
      'hawkeye', collectedAt, providers.detectTyposquat(request.system, request.name),
    ),
    links: {
      depsDev: depsDevUrl(request.system, request.name, resolvedVersion),
      osv: osvSearchUrl(request.system, request.name),
      scorecard: scorecard?.projectUrl ?? null,
    },
  };
}
