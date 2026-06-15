import type { CheckResult, Violation } from './types.js';

/**
 * Map a Hawkeye audit result to SARIF 2.1.0 so it can be consumed by GitHub
 * Code Scanning and other SARIF-aware tooling.
 *
 * Single-package audits have no source-file location, so findings are attached
 * to a logical location (the package coordinate). File-level locations arrive
 * with whole-repo `hawkeye scan` (#23).
 */

const TOOL_NAME = 'Hawkeye Agent';
const INFO_URI = 'https://github.com/ryanHwH20/oss-hawkeye-agent';

interface RuleDef {
  id: string;
  name: string;
  shortDescription: string;
}

const RULES: RuleDef[] = [
  { id: 'LICENSE', name: 'DirectLicenseBlocked', shortDescription: 'Direct dependency uses a policy-blocked license' },
  { id: 'VULNERABILITY', name: 'KnownVulnerability', shortDescription: 'Known vulnerability affects this package version' },
  { id: 'SBOM_LICENSE', name: 'TransitiveLicenseBlocked', shortDescription: 'Transitive dependency uses a policy-blocked license' },
  { id: 'SBOM_VULNERABILITY', name: 'TransitiveVulnerability', shortDescription: 'Transitive dependency has a known vulnerability' },
  { id: 'SCORECARD', name: 'ScorecardConcern', shortDescription: 'OpenSSF Scorecard posture below the configured threshold' },
  { id: 'UNVERIFIED', name: 'Unverified', shortDescription: 'A data source could not be verified — failing closed' },
];

/** Blocking findings are errors; advisories are notes. */
function levelFor(v: Violation): 'error' | 'note' {
  return v.severity === 'LOW' ? 'note' : 'error';
}

export function toSarif(result: CheckResult): object {
  const pkg = `${result.name}@${result.version}`;
  const results: object[] = [];

  for (const v of result.violations) {
    const affected = v.affectedDep ?? pkg;
    results.push({
      ruleId: v.type,
      level: levelFor(v),
      message: { text: `${v.reason}: ${v.details.join(', ')}. ${v.riskExplanation}` },
      locations: [{ logicalLocations: [{ fullyQualifiedName: affected, kind: 'package' }] }],
      partialFingerprints: { hawkeye: `${v.type}:${affected}` },
      properties: {
        ecosystem: result.system,
        package: pkg,
        affected,
        severity: v.severity,
        path: v.path ?? [],
      },
    });
  }

  // Fail-closed: each unverifiable source is surfaced as an error so a broken
  // audit cannot pass silently through a SARIF gate.
  for (const source of result.unverified) {
    results.push({
      ruleId: 'UNVERIFIED',
      level: 'error',
      message: { text: `Could not verify ${source}. Failing closed: this package was not confirmed safe.` },
      locations: [{ logicalLocations: [{ fullyQualifiedName: pkg, kind: 'package' }] }],
      partialFingerprints: { hawkeye: `UNVERIFIED:${source}:${pkg}` },
      properties: { ecosystem: result.system, package: pkg, source },
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            informationUri: INFO_URI,
            rules: RULES.map(r => ({
              id: r.id,
              name: r.name,
              shortDescription: { text: r.shortDescription },
            })),
          },
        },
        results,
      },
    ],
  };
}
