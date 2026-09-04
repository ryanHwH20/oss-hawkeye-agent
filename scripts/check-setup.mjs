import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const checks = [];

function addCheck(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const root = process.cwd();

addCheck('CLI build output exists', existsSync(resolve(root, 'dist', 'cli.js')), resolve(root, 'dist', 'cli.js'));
addCheck('Core build output exists', existsSync(resolve(root, 'dist', 'checker.js')), resolve(root, 'dist', 'checker.js'));

const skillPaths = [
  ['Canonical Skill', resolve(root, 'skills', 'oss-hawkeye', 'SKILL.md')],
  ['Codex Skill', resolve(root, '.agents', 'skills', 'oss-hawkeye', 'SKILL.md')],
  ['Claude Code Skill', resolve(root, '.claude', 'skills', 'oss-hawkeye', 'SKILL.md')],
  ['GitHub Copilot Skill', resolve(root, '.github', 'skills', 'oss-hawkeye', 'SKILL.md')],
];
for (const [name, path] of skillPaths) addCheck(`${name} exists`, existsSync(path), path);

const integrationPaths = [
  ['Codex MCP configuration', resolve(root, '.codex', 'config.toml')],
  ['Claude Code MCP configuration', resolve(root, '.mcp.json')],
  ['Compiled MCP launcher', resolve(root, 'adapters', 'mcp', 'launcher.mjs')],
];
for (const [name, path] of integrationPaths) addCheck(`${name} exists`, existsSync(path), path);

const instructionsPath = resolve(root, '.github', 'copilot-instructions.md');
addCheck('Always-on copilot instructions exist', existsSync(instructionsPath), instructionsPath);

const failed = checks.filter((c) => !c.pass);
for (const c of checks) {
  const status = c.pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${c.name}: ${c.detail}`);
}

if (failed.length > 0) {
  console.error(`\nSetup check failed: ${failed.length} issue(s).`);
  process.exit(1);
}

console.log('\nSetup check passed.');
