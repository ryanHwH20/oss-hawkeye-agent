import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const checks = [];

function addCheck(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const root = process.cwd();

const distServer = resolve(root, 'dist', 'server.js');
addCheck('Build output exists', existsSync(distServer), distServer);

const workspaceMcp = resolve(root, '.vscode', 'mcp.json');
let mcpHasServer = false;
if (existsSync(workspaceMcp)) {
  try {
    const mcp = JSON.parse(readFileSync(workspaceMcp, 'utf8'));
    mcpHasServer = Boolean(mcp?.mcpServers?.['oss-hawkeye-agent']);
  } catch {
    mcpHasServer = false;
  }
}
addCheck('Workspace MCP server configured', mcpHasServer, workspaceMcp);

const skillPath = resolve(root, '.github', 'skills', 'hawkeye-agent', 'SKILL.md');
addCheck('Skill file in auto-discovery path', existsSync(skillPath), skillPath);

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
