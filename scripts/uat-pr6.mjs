#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const cases = [
  { ecosystem: 'JavaScript / TypeScript', system: 'NPM', command: 'npm install is-number@7.0.0' },
  { ecosystem: 'Python', system: 'PYPI', command: 'pip install idna==3.7' },
  { ecosystem: 'Rust', system: 'CARGO', command: 'cargo add itoa@1.0.11' },
  { ecosystem: 'Go', system: 'GO', command: 'go get github.com/google/uuid@v1.6.0' },
  { ecosystem: 'Ruby', system: 'RUBYGEMS', command: 'gem install rake -v 13.2.1' },
  { ecosystem: '.NET / C#', system: 'NUGET', command: 'dotnet add package Newtonsoft.Json --version 13.0.3' },
  { ecosystem: 'Java / Kotlin', system: 'MAVEN', command: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.13' },
];

const failures = [];
const rows = [];
const root = process.cwd();

function accept(condition, message) {
  if (!condition) failures.push(message);
}

function outputOf(result, label) {
  if (result.isError || !result.structuredContent) {
    const message = result.content?.find(content => content.type === 'text')?.text ?? 'missing MCP output';
    throw new Error(`${label}: ${message}`);
  }
  return result.structuredContent;
}

console.log('PR6 maintainer UAT');
console.log('This verifies native Skill discovery and connects through the committed Claude MCP configuration.');
console.log('It performs live evidence queries but never executes package-manager commands.\n');

const canonical = await readFile(resolve(root, 'skills/oss-hawkeye/SKILL.md'), 'utf8');
for (const path of [
  '.agents/skills/oss-hawkeye/SKILL.md',
  '.claude/skills/oss-hawkeye/SKILL.md',
  '.github/skills/oss-hawkeye/SKILL.md',
]) {
  accept(await readFile(resolve(root, path), 'utf8').catch(() => null) === canonical,
    `${path} differs from the canonical Skill.`);
}

const claudeConfig = JSON.parse(await readFile(resolve(root, '.mcp.json'), 'utf8'));
const server = claudeConfig.mcpServers?.['oss-hawkeye'];
accept(server?.command === 'node', 'Claude MCP configuration must launch Node.js.');
const args = (server?.args ?? []).map(arg => arg.replace('${CLAUDE_PROJECT_DIR:-.}', root));
accept(args.length === 1 && resolve(args[0]) === resolve(root, 'adapters/mcp/launcher.mjs'),
  'Claude MCP configuration does not target the compiled Hawkeye launcher.');

const codexConfig = await readFile(resolve(root, '.codex/config.toml'), 'utf8');
accept(codexConfig.includes('[mcp_servers.oss-hawkeye]'), 'Codex MCP server entry is missing.');
accept(codexConfig.includes('args = ["adapters/mcp/launcher.mjs"]'),
  'Codex MCP configuration does not target the same launcher.');

const transport = new StdioClientTransport({
  command: server?.command ?? 'node',
  args,
  cwd: root,
  stderr: 'pipe',
  maxBufferSize: 2 * 1024 * 1024,
});
const client = new Client({ name: 'hawkeye-pr6-uat', version: '1.0.0' });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  accept(isDeepStrictEqual(tools.map(tool => tool.name), [
    'hawkeye_check_action',
    'hawkeye_next_action',
    'hawkeye_submit_result',
  ]), 'Expected exactly the three canonical Hawkeye workflow tools.');

  for (const item of cases) {
    try {
      const checked = outputOf(await client.callTool({
        name: 'hawkeye_check_action',
        arguments: { command: item.command },
      }), item.ecosystem);
      const decision = checked.state.decisions.at(-1);
      const coordinate = decision?.packages?.[0];
      const replayed = outputOf(await client.callTool({
        name: 'hawkeye_next_action',
        arguments: { state: JSON.parse(JSON.stringify(checked.state)) },
      }), `${item.ecosystem} replay`);
      const deterministic = isDeepStrictEqual(replayed.nextAction, checked.nextAction);

      accept(checked.state.intent.command === item.command,
        `${item.ecosystem}: exact command was not preserved.`);
      accept(coordinate?.system === item.system,
        `${item.ecosystem}: expected ${item.system}, received ${coordinate?.system ?? 'none'}.`);
      accept(checked.summary.includes('No package-manager command was executed.'),
        `${item.ecosystem}: no-execution boundary is absent.`);
      accept(deterministic, `${item.ecosystem}: JSON replay changed the next action.`);

      rows.push({
        ecosystem: item.ecosystem,
        coordinate: coordinate
          ? `${coordinate.system}:${coordinate.name}@${coordinate.resolvedVersion ?? coordinate.requestedVersion ?? 'latest'}`
          : 'ERROR',
        verdict: decision?.effectiveVerdict ?? checked.status,
        action: checked.nextAction?.kind ?? '-',
        skill: 'synced',
        deterministic: deterministic ? 'yes' : 'NO',
      });
    } catch (error) {
      failures.push(`${item.ecosystem}: ${error instanceof Error ? error.message : String(error)}`);
      rows.push({ ecosystem: item.ecosystem, coordinate: 'ERROR', verdict: '-', action: '-', skill: '-', deterministic: 'NO' });
    }
  }
} catch (error) {
  failures.push(`MCP connection: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.close().catch(() => undefined);
}

console.table(rows);

if (failures.length > 0) {
  console.error('\nUAT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nUAT PASSED: one Skill drives the configured MCP workflow for all seven ecosystems.');
  console.log('No package-manager command was executed.');
}
