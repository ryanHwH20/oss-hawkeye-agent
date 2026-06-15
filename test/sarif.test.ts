import { describe, it, expect } from 'vitest';
import { toSarif } from '../src/sarif.js';
import type { CheckResult, Violation } from '../src/types.js';

function makeResult(over: Partial<CheckResult> = {}): CheckResult {
  return {
    name: 'demo',
    version: '1.0.0',
    system: 'NPM',
    licenses: ['MIT'],
    rootFlaggedLicenses: [],
    advisoryCount: 0,
    vulnerabilities: [],
    osvScannerUsed: false,
    scorecardScore: null,
    scorecardDate: null,
    scorecardChecks: [],
    depCount: { direct: 0, indirect: 0 },
    depLicenses: [],
    violations: [],
    verdict: 'SAFE',
    unverified: [],
    depsDevUrl: '',
    osvQueryUrl: '',
    scorecardSourceUrl: null,
    ...over,
  };
}

const vuln: Violation = {
  type: 'VULNERABILITY', severity: 'HIGH', reason: 'Known vulnerability',
  details: ['CVE-2020-0001'], riskExplanation: 'Exploitable.',
};
const advisory: Violation = {
  type: 'SCORECARD', severity: 'LOW', reason: 'Scorecard below threshold',
  details: ['3.0/10'], riskExplanation: 'Immature practices.',
};

describe('toSarif (issue #11)', () => {
  it('emits a valid SARIF 2.1.0 envelope with the tool driver and rules', () => {
    const s = toSarif(makeResult()) as any;
    expect(s.version).toBe('2.1.0');
    expect(s.$schema).toContain('sarif-2.1.0');
    expect(s.runs[0].tool.driver.name).toBe('Hawkeye Agent');
    expect(s.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
    expect(s.runs[0].results).toHaveLength(0); // clean package → no findings
  });

  it('maps blocking violations to error level and advisories to note level', () => {
    const s = toSarif(makeResult({ verdict: 'BLOCKED', violations: [vuln, advisory] })) as any;
    const results = s.runs[0].results;
    expect(results).toHaveLength(2);
    expect(results.find((r: any) => r.ruleId === 'VULNERABILITY').level).toBe('error');
    expect(results.find((r: any) => r.ruleId === 'SCORECARD').level).toBe('note');
  });

  it('surfaces each unverified source as an error result (fail-closed)', () => {
    const s = toSarif(makeResult({ verdict: 'UNKNOWN', unverified: ['Vulnerabilities (OSV)'] })) as any;
    const results = s.runs[0].results;
    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe('UNVERIFIED');
    expect(results[0].level).toBe('error');
    expect(results[0].message.text).toContain('Vulnerabilities (OSV)');
  });

  it('attaches the affected dependency as a logical location', () => {
    const sbom: Violation = {
      type: 'SBOM_VULNERABILITY', severity: 'HIGH', reason: 'Transitive vuln',
      details: ['CVE-2021-0002'], riskExplanation: 'Deep dep.', affectedDep: 'left-pad@1.0.0',
    };
    const s = toSarif(makeResult({ verdict: 'BLOCKED', violations: [sbom] })) as any;
    expect(s.runs[0].results[0].locations[0].logicalLocations[0].fullyQualifiedName).toBe('left-pad@1.0.0');
  });
});
