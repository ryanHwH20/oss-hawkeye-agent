import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Integration test for the Claude Code PreToolUse hook (issue #26).
// We drive the real hook script with a *fake* hawkeye CLI so no network is hit
// and exit codes are deterministic. The fake is invoked as `node <fakeCli>`,
// which also exercises the HAWKEYE_BIN-with-arguments fix.

const HOOK = resolve(__dirname, '../hooks/claude-code-precheck.mjs');
const FAKE_CLI = join(tmpdir(), `hawkeye-fake-cli-${process.pid}.mjs`);

// Fake CLI contract: argv = ['check-command', '<command>'].
//   command contains BLOCKME  → exit 1 (blocked / unverifiable)
//   command contains TOOLERR  → exit 2 (tool itself failed)
//   otherwise                 → exit 0 (approved / nothing to audit)
beforeAll(() => {
  writeFileSync(
    FAKE_CLI,
    `const cmd = process.argv[3] ?? '';
     if (cmd.includes('BLOCKME')) { process.stdout.write('BLOCKED: policy'); process.exit(1); }
     if (cmd.includes('TOOLERR')) { process.exit(2); }
     process.exit(0);\n`
  );
});

afterAll(() => rmSync(FAKE_CLI, { force: true }));

interface HookRun { status: number; stderr: string; }

function runHook(command: string, bin = `node ${FAKE_CLI}`): HookRun {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  return runHookRaw(payload, bin);
}

function runHookRaw(input: string, bin = `node ${FAKE_CLI}`): HookRun {
  try {
    execFileSync('node', [HOOK], {
      input,
      env: { ...process.env, HAWKEYE_BIN: bin },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (e: any) {
    return { status: e.status ?? -1, stderr: (e.stderr ?? '').toString() };
  }
}

describe('claude-code-precheck hook (issue #26)', () => {
  it('allows a non-install command without invoking the CLI', () => {
    expect(runHook('ls -la').status).toBe(0);
  });

  it('allows non-install package-manager commands (npm ci, go build)', () => {
    expect(runHook('npm ci').status).toBe(0);
    expect(runHook('go build ./...').status).toBe(0);
  });

  it('allows an approved install (CLI exit 0)', () => {
    expect(runHook('npm install lodash').status).toBe(0);
  });

  it('blocks a policy-violating install with exit 2 and shows the reason', () => {
    const r = runHook('npm install BLOCKME');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Hawkeye blocked this install');
    expect(r.stderr).toContain('BLOCKED: policy');
  });

  it('fails closed (exit 2) when the CLI errors on a detected install', () => {
    const r = runHook('npm install TOOLERR');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('could not verify');
  });

  it('fails closed (exit 2) when Hawkeye is not runnable (bad HAWKEYE_BIN)', () => {
    const r = runHook('npm install lodash', '/nonexistent/hawkeye-binary-xyz');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('could not verify');
  });

  it('supports HAWKEYE_BIN with arguments (node <cli.js>)', () => {
    // The whole suite relies on `node <fakeCli>`; this asserts it explicitly:
    // a blocked verdict only surfaces if the two-token BIN was spawned correctly.
    expect(runHook('npm install BLOCKME').status).toBe(2);
  });

  it('does not interfere with non-JSON stdin', () => {
    expect(runHookRaw('not json at all').status).toBe(0);
  });
});
