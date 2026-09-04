import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionAssessment, LoadedPolicy, Policy } from '../../src/index.js';
import { createRun, nextAction, submitResult } from '../../src/index.js';
import {
  MAX_COMMAND_BYTES,
  MAX_RESULT_BYTES,
  MAX_STATE_BYTES,
} from '../../adapters/mcp/src/schemas.js';
import { createHawkeyeMcpServer } from '../../adapters/mcp/src/server.js';
import { HawkeyeMcpService } from '../../adapters/mcp/src/service.js';
import type { HawkeyeMcpDependencies, HawkeyeMcpOutput } from '../../adapters/mcp/src/types.js';

const workspace = '/repo';
const time = '2026-09-04T01:00:00.000Z';
const policy: Policy = {
  organizationName: 'MCP Test Org',
  blockedLicenses: ['GPL-3.0-only'],
  minScorecardScore: 4,
  blockVulnerabilities: true,
  minBlockingSeverity: 'MEDIUM',
  blockDeprecated: true,
  blockTyposquats: true,
  exceptionFormUrl: 'https://example.test/exceptions',
  ai: null,
};
const loadedPolicy: LoadedPolicy = {
  policy,
  ref: { id: 'MCP Test Org', digest: 'sha256:mcp-test-policy' },
  source: { kind: 'workspace', path: '/repo/.audit-agent.yaml' },
};

const ecosystemCases = [
  { label: 'NPM', system: 'NPM', name: 'is-number', version: '7.0.0', command: 'npm install is-number@7.0.0' },
  { label: 'PyPI', system: 'PYPI', name: 'idna', version: '3.7', command: 'pip install idna==3.7' },
  { label: 'Cargo', system: 'CARGO', name: 'itoa', version: '1.0.11', command: 'cargo add itoa@1.0.11' },
  { label: 'Go', system: 'GO', name: 'github.com/google/uuid', version: 'v1.6.0', command: 'go get github.com/google/uuid@v1.6.0' },
  { label: 'RubyGems', system: 'RUBYGEMS', name: 'rake', version: '13.2.1', command: 'gem install rake -v 13.2.1' },
  { label: 'NuGet', system: 'NUGET', name: 'Newtonsoft.Json', version: '13.0.3', command: 'dotnet add package Newtonsoft.Json --version 13.0.3' },
  { label: 'Maven', system: 'MAVEN', name: 'org.slf4j:slf4j-api', version: '2.0.13', command: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.13' },
] as const;

function assessmentFor(command: string): ActionAssessment {
  const item = ecosystemCases.find(candidate => candidate.command === command);
  if (!item) {
    return {
      schemaVersion: 1,
      applicability: 'not_applicable',
      subject: { kind: 'shell_command', command, cwd: workspace },
      reason: 'The command is not a supported package-install action.',
    };
  }
  const subject = { kind: 'shell_command' as const, command, cwd: workspace };
  return {
    schemaVersion: 1,
    applicability: 'applicable',
    decision: {
      schemaVersion: 1,
      id: `decision-${item.system}`,
      subject,
      packages: [{
        system: item.system,
        name: item.name,
        requestedVersion: item.version,
        resolvedVersion: item.version,
      }],
      rawVerdict: 'SAFE',
      effectiveVerdict: 'SAFE',
      findings: [],
      evidence: [],
      errors: [],
      overrides: [],
      remediation: [],
      policy: loadedPolicy.ref,
      decidedAt: time,
    },
    nextAction: {
      id: `decision-${item.system}:execute`,
      kind: 'EXECUTE_ALLOWED_ACTION',
      command,
      expectedResult: 'external enforcement then execution',
    },
  };
}

function dependencies(): HawkeyeMcpDependencies {
  let tick = 0;
  return {
    loadPolicyWithMetadata: vi.fn(() => loadedPolicy),
    assessAction: vi.fn(async intent => assessmentFor(intent.command)),
    createRun,
    nextAction,
    submitResult,
    now: () => new Date(Date.parse(time) + tick++ * 1000),
    runId: () => `mcp-run-${tick}`,
  };
}

type Connected = { client: Client; close: () => Promise<void> };
const connections: Connected[] = [];

async function connect(): Promise<Connected> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createHawkeyeMcpServer(new HawkeyeMcpService(workspace, dependencies()));
  const client = new Client({ name: 'hawkeye-mcp-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const connected = {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
  connections.push(connected);
  return connected;
}

function outputOf(result: Awaited<ReturnType<Client['callTool']>>): HawkeyeMcpOutput {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  const text = result.content.find(content => content.type === 'text');
  expect(text?.type === 'text' ? JSON.parse(text.text) : undefined).toEqual(result.structuredContent);
  return result.structuredContent as unknown as HawkeyeMcpOutput;
}

afterEach(async () => {
  await Promise.all(connections.splice(0).map(connection => connection.close()));
});

describe('Hawkeye MCP protocol contract', () => {
  it('publishes only the three deterministic, strictly-schemaed workflow tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map(tool => tool.name)).toEqual([
      'hawkeye_check_action',
      'hawkeye_next_action',
      'hawkeye_submit_result',
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });

  it.each(ecosystemCases)('checks $label through the official MCP client without executing it', async item => {
    const { client } = await connect();
    const checked = outputOf(await client.callTool({
      name: 'hawkeye_check_action',
      arguments: { command: item.command },
    }));

    expect(checked.status).toBe('SAFE');
    expect(checked.state.intent).toEqual({ kind: 'shell_command', command: item.command, cwd: workspace });
    expect(checked.state.decisions[0]?.packages[0]).toMatchObject({
      system: item.system,
      name: item.name,
      requestedVersion: item.version,
      resolvedVersion: item.version,
    });
    expect(checked.nextAction?.kind).toBe('EXECUTE_ALLOWED_ACTION');
    expect(checked.summary).toContain('No package-manager command was executed.');

    const replayed = outputOf(await client.callTool({
      name: 'hawkeye_next_action',
      arguments: { state: JSON.parse(JSON.stringify(checked.state)) },
    }));
    expect(replayed).toMatchObject({ status: 'SAFE', nextAction: checked.nextAction });
  });

  it('advances only when the caller submits the exact pending action result', async () => {
    const { client } = await connect();
    const checked = outputOf(await client.callTool({
      name: 'hawkeye_check_action',
      arguments: { command: ecosystemCases[0].command },
    }));
    const action = checked.nextAction;
    expect(action?.kind).toBe('EXECUTE_ALLOWED_ACTION');

    const submitted = outputOf(await client.callTool({
      name: 'hawkeye_submit_result',
      arguments: {
        state: checked.state,
        actionId: action?.id,
        result: {
          schemaVersion: 1,
          kind: 'EXECUTION_COMPLETED',
          command: action?.command,
          status: 'succeeded',
          exitCode: 0,
          completedAt: '2026-09-04T01:05:00.000Z',
        },
      },
    }));
    expect(submitted.state.phase).toBe('completed');
    expect(submitted.nextAction).toBeNull();
    expect(submitted.state.actionHistory.at(-1)?.result.kind).toBe('EXECUTION_COMPLETED');
  });

  it('fails closed for cross-workspace state and malformed tool input', async () => {
    const { client } = await connect();
    const checked = outputOf(await client.callTool({
      name: 'hawkeye_check_action',
      arguments: { command: ecosystemCases[0].command },
    }));
    const foreignState = structuredClone(checked.state);
    foreignState.intent.cwd = '/different-workspace';

    const rejected = await client.callTool({
      name: 'hawkeye_next_action',
      arguments: { state: foreignState },
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('different MCP workspace') }),
    ]));

    const malformed = await client.callTool({
      name: 'hawkeye_check_action',
      arguments: { command: ecosystemCases[0].command, unexpected: true },
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Input validation error') }),
    ]));
  });

  it('returns NOT_APPLICABLE without inventing a verdict for unrelated commands', async () => {
    const { client } = await connect();
    const output = outputOf(await client.callTool({
      name: 'hawkeye_check_action',
      arguments: { command: 'echo hello' },
    }));
    expect(output.status).toBe('NOT_APPLICABLE');
    expect(output.state.decisions).toEqual([]);
    expect(output.state.phase).toBe('completed');
    expect(output.nextAction).toBeNull();
  });
});

describe('Hawkeye MCP adapter boundaries', () => {
  it('rejects commands larger than the byte limit before assessment', async () => {
    const deps = dependencies();
    const service = new HawkeyeMcpService(workspace, deps);
    await expect(service.checkAction('x'.repeat(MAX_COMMAND_BYTES + 1))).rejects.toThrow('payload limit');
    expect(deps.assessAction).not.toHaveBeenCalled();
  });

  it('rejects oversized carried state and submitted results', async () => {
    const service = new HawkeyeMcpService(workspace, dependencies());
    const checked = await service.checkAction(ecosystemCases[0].command);
    const oversizedState = structuredClone(checked.state);
    oversizedState.terminalReason = 'x'.repeat(MAX_STATE_BYTES);
    expect(() => service.getNextAction(oversizedState)).toThrow('payload limit');

    expect(() => service.submitActionResult({
      state: checked.state,
      actionId: checked.nextAction?.id ?? '',
      result: {
        schemaVersion: 1,
        kind: 'EXECUTION_COMPLETED',
        command: checked.nextAction?.command ?? '',
        status: 'failed',
        exitCode: 1,
        completedAt: '2026-09-04T01:05:00.000Z',
        error: 'x'.repeat(MAX_RESULT_BYTES),
      },
    })).toThrow('payload limit');
  });

  it('does not import process execution or duplicate security evidence logic', () => {
    const sources = ['service.ts', 'server.ts', 'runtime.ts', 'main.ts']
      .map(file => readFileSync(resolve('adapters/mcp/src', file), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(/node:child_process|\bspawn\s*\(|\bexec(File|Sync)?\s*\(/);
    expect(sources).not.toMatch(/osv\.dev|deps\.dev|scorecard|typosquat/i);
  });
});
