import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPackage } from '../src/checker.js';
import { __resetCaches } from '../src/api/deps-dev.js';
import { auditCommand } from '../src/command.js';
import type { Policy } from '../src/types.js';

const policy: Policy = {
  organizationName: 'Cross-ecosystem test',
  blockedLicenses: ['GPL-3.0-only'],
  minScorecardScore: 4,
  blockVulnerabilities: true,
  minBlockingSeverity: 'MEDIUM',
  blockDeprecated: true,
  blockTyposquats: true,
  exceptionFormUrl: '',
};

const ecosystems = [
  { system: 'NPM', name: 'hawkeye-js-fixture', version: '1.2.3', osv: 'npm', command: 'npm install hawkeye-js-fixture@1.2.3' },
  { system: 'PYPI', name: 'hawkeye-python-fixture', version: '2.3.4', osv: 'PyPI', command: 'pip install hawkeye-python-fixture==2.3.4' },
  { system: 'CARGO', name: 'hawkeye-rust-fixture', version: '3.4.5', osv: 'crates.io', command: 'cargo add hawkeye-rust-fixture@3.4.5' },
  { system: 'GO', name: 'example.com/hawkeye/go-fixture', version: 'v4.5.6', osv: 'Go', command: 'go get example.com/hawkeye/go-fixture@v4.5.6' },
  { system: 'RUBYGEMS', name: 'hawkeye-ruby-fixture', version: '5.6.7', osv: 'RubyGems', command: 'gem install hawkeye-ruby-fixture -v 5.6.7' },
  { system: 'NUGET', name: 'Hawkeye.DotNet.Fixture', version: '6.7.8', osv: 'NuGet', command: 'dotnet add package Hawkeye.DotNet.Fixture --version 6.7.8' },
  { system: 'MAVEN', name: 'org.hawkeye:java-fixture', version: '7.8.9', osv: 'Maven', command: 'mvn dependency:get -Dartifact=org.hawkeye:java-fixture:7.8.9' },
] as const;

function response(data: unknown): unknown {
  return { ok: true, status: 200, json: async () => data };
}

function stubCleanPackage(system: string, name: string, version: string): Array<Record<string, unknown>> {
  const osvBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.osv.dev')) {
      osvBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return response({ vulns: [] });
    }
    if (url.includes(':dependencies')) {
      return response({
        nodes: [{ versionKey: { system, name, version }, relation: 'SELF' }],
        edges: [],
      });
    }
    if (url.includes('/versions/')) {
      return response({ versionKey: { system, name, version }, licenses: ['MIT'] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return osvBodies;
}

describe('supported ecosystem admission', () => {
  beforeEach(() => __resetCaches());
  afterEach(() => vi.unstubAllGlobals());

  it.each(ecosystems)(
    'audits an explicitly versioned $system package and uses the correct OSV ecosystem',
    async ({ system, name, version, osv }) => {
      const osvBodies = stubCleanPackage(system, name, version);

      const result = await checkPackage(system, name, version, policy);

      expect(result).toMatchObject({ system, name, version, verdict: 'SAFE' });
      expect(osvBodies).toContainEqual({
        version,
        package: { name, ecosystem: osv },
      });
    }
  );

  it.each(ecosystems)(
    'preserves the explicit $system version through the legacy command compatibility path',
    async ({ system, name, version, command }) => {
      stubCleanPackage(system, name, version);

      const audit = await auditCommand(command, policy, []);

      expect(audit).toMatchObject({
        detected: true,
        command,
        system,
        verdict: 'SAFE',
        effectiveVerdict: 'SAFE',
        results: [{ system, name, version, verdict: 'SAFE' }],
      });
    }
  );
});
