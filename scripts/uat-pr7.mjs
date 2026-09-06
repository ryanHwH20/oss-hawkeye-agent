#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { isDeepStrictEqual } from 'node:util';
import { assertPackageFiles } from './lib/package-contract.mjs';

const cases = [
  { ecosystem: 'JavaScript / TypeScript', system: 'NPM', command: 'npm install is-number@7.0.0' },
  { ecosystem: 'Python', system: 'PYPI', command: 'pip install idna==3.7' },
  { ecosystem: 'Rust', system: 'CARGO', command: 'cargo add itoa@1.0.11' },
  { ecosystem: 'Go', system: 'GO', command: 'go get github.com/google/uuid@v1.6.0' },
  { ecosystem: 'Ruby', system: 'RUBYGEMS', command: 'gem install rake -v 13.2.1' },
  { ecosystem: '.NET / C#', system: 'NUGET', command: 'dotnet add package Newtonsoft.Json --version 13.0.3' },
  { ecosystem: 'Java / Kotlin', system: 'MAVEN', command: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.13' },
];

const root = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'hawkeye-pr7-'));
const packageOutput = join(temporaryRoot, 'package');
const consumer = join(temporaryRoot, 'consumer');
const cache = join(temporaryRoot, 'npm-cache');
const failures = [];
const rows = [];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const expectedVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
let client;

function accept(condition, message) {
  if (!condition) failures.push(message);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? 'no status'}):\n${result.stderr || result.stdout}`);
  }
  return result;
}

function outputOf(result, label) {
  if (result.isError || !result.structuredContent) {
    const message = result.content?.find(content => content.type === 'text')?.text ?? 'missing MCP output';
    throw new Error(`${label}: ${message}`);
  }
  return result.structuredContent;
}

console.log('PR7 maintainer UAT');
console.log('This packs Hawkeye, installs the tarball into a clean consumer, and launches MCP from node_modules.');
console.log('The local tarball installation uses npm with lifecycle scripts disabled. Assessed package commands are never executed.\n');

try {
  mkdirSync(packageOutput);
  mkdirSync(consumer);
  const packed = run(npmCommand, [
    'pack', '--json', '--ignore-scripts', '--pack-destination', packageOutput, '--cache', cache,
  ], root);
  const packResult = JSON.parse(packed.stdout)[0];
  assertPackageFiles(packResult.files);
  const tarball = resolve(packageOutput, basename(packResult.filename));

  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true }));
  run(npmCommand, [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', cache, tarball,
  ], consumer);

  const installed = join(consumer, 'node_modules', 'oss-hawkeye-agent');
  const installedPackage = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  accept(installedPackage.version === expectedVersion,
    `Installed package version ${installedPackage.version} does not match expected ${expectedVersion}.`);
  accept(installedPackage.bin?.hawkeye === 'dist/cli.js', 'Installed package has no hawkeye CLI bin entry.');
  accept(installedPackage.bin?.['hawkeye-mcp'] === 'adapters/mcp/launcher.mjs', 'Installed package has no hawkeye-mcp bin entry.');
  accept(existsSync(join(installed, 'adapters', 'claude-code.mjs')), 'Installed package has no Claude enforcement adapter.');
  accept(existsSync(join(installed, 'skills', 'oss-hawkeye', 'SKILL.md')), 'Installed package has no canonical Agent Skill.');

  const cli = spawnSync(process.execPath, [join(installed, 'dist', 'cli.js')], { cwd: consumer, encoding: 'utf8' });
  accept(cli.status === 2 && cli.stderr.includes('Usage: hawkeye'), 'Installed CLI did not load and return its usage contract.');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(installed, 'adapters', 'mcp', 'launcher.mjs')],
    cwd: consumer,
    stderr: 'pipe',
    maxBufferSize: 2 * 1024 * 1024,
  });
  client = new Client({ name: 'hawkeye-pr7-uat', version: '1.0.0' });
  await client.connect(transport);
  accept(client.getServerVersion()?.version === expectedVersion,
    `Installed MCP server version ${client.getServerVersion()?.version ?? 'missing'} does not match expected ${expectedVersion}.`);
  const { tools } = await client.listTools();
  accept(isDeepStrictEqual(tools.map(tool => tool.name), [
    'hawkeye_check_action',
    'hawkeye_next_action',
    'hawkeye_submit_result',
  ]), 'Installed MCP server did not expose the canonical three-tool contract.');

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

      accept(checked.state.intent.command === item.command, `${item.ecosystem}: exact command was not preserved.`);
      accept(realpathSync(checked.state.intent.cwd) === realpathSync(consumer),
        `${item.ecosystem}: MCP did not bind to the clean consumer workspace.`);
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
        installed: 'yes',
        deterministic: deterministic ? 'yes' : 'NO',
      });
    } catch (error) {
      failures.push(`${item.ecosystem}: ${error instanceof Error ? error.message : String(error)}`);
      rows.push({ ecosystem: item.ecosystem, coordinate: 'ERROR', verdict: '-', action: '-', installed: '-', deterministic: 'NO' });
    }
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await client?.close().catch(() => undefined);
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.table(rows);

if (failures.length > 0) {
  console.error('\nUAT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nUAT PASSED: the installed npm artifact serves all seven ecosystems through the canonical MCP contract.');
  console.log('No assessed package-manager command was executed.');
}
