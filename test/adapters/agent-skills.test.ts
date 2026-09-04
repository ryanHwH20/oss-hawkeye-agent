import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = process.cwd();
const canonicalPath = resolve(root, 'skills', 'oss-hawkeye', 'SKILL.md');
const discoveryPaths = [
  resolve(root, '.agents', 'skills', 'oss-hawkeye', 'SKILL.md'),
  resolve(root, '.claude', 'skills', 'oss-hawkeye', 'SKILL.md'),
  resolve(root, '.github', 'skills', 'oss-hawkeye', 'SKILL.md'),
];

function splitSkill(source: string) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  if (!match) throw new Error('SKILL.md must contain YAML frontmatter and a body.');
  return { metadata: parse(match[1]) as Record<string, unknown>, body: match[2] };
}

describe('cross-agent Hawkeye Skill distribution', () => {
  it('uses one canonical skill and byte-identical platform discovery copies', () => {
    const canonical = readFileSync(canonicalPath, 'utf8');
    for (const path of discoveryPaths) expect(readFileSync(path, 'utf8')).toBe(canonical);
    expect(existsSync(resolve(root, '.github', 'skills', 'hawkeye-agent', 'SKILL.md'))).toBe(false);
  });

  it('has valid discovery metadata and maps every canonical workflow outcome', () => {
    const { metadata, body } = splitSkill(readFileSync(canonicalPath, 'utf8'));
    expect(metadata).toMatchObject({ name: 'oss-hawkeye' });
    expect(metadata.description).toEqual(expect.stringContaining('Hawkeye'));

    expect(body).toContain('hawkeye_check_action');
    expect(body).toContain('hawkeye_next_action');
    expect(body).toContain('hawkeye_submit_result');
    for (const status of ['SAFE', 'BLOCKED', 'UNKNOWN', 'NOT_APPLICABLE']) {
      expect(body).toContain(status);
    }
    for (const ecosystem of ['npm', 'pip', 'Cargo', 'Go', 'RubyGems', 'NuGet', 'Maven']) {
      expect(body).toContain(ecosystem);
    }
  });

  it('removes conversational bypasses and keeps execution outside assessment', () => {
    const sources = [
      readFileSync(canonicalPath, 'utf8'),
      readFileSync(resolve(root, '.github', 'copilot-instructions.md'), 'utf8'),
    ].join('\n');

    expect(sources).not.toMatch(/direct install now|skip audit/i);
    expect(sources).toMatch(/Never offer a skip-audit or direct-install bypass/i);
    expect(sources).toMatch(/does not execute the package manager/i);
    expect(sources).toMatch(/Never self-approve an exception/i);
  });

  it('ships project-scoped MCP configuration for Codex and Claude Code', () => {
    const claude = JSON.parse(readFileSync(resolve(root, '.mcp.json'), 'utf8'));
    expect(claude.mcpServers['oss-hawkeye']).toEqual({
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR:-.}/adapters/mcp/launcher.mjs'],
    });

    const codex = readFileSync(resolve(root, '.codex', 'config.toml'), 'utf8');
    expect(codex).toContain('[mcp_servers.oss-hawkeye]');
    expect(codex).toContain('args = ["adapters/mcp/launcher.mjs"]');
    expect(codex).toContain('enabled = true');
  });
});
