import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const checks = [];

function addCheck(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const root = process.cwd();

addCheck('CLI build output exists', existsSync(resolve(root, 'dist', 'cli.js')), resolve(root, 'dist', 'cli.js'));
addCheck('Core build output exists', existsSync(resolve(root, 'dist', 'checker.js')), resolve(root, 'dist', 'checker.js'));

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
