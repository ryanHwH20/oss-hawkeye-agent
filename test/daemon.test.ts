import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:net';
import { createDaemonServer } from '../src/daemon.js';
import { daemonAudit } from '../src/daemon-client.js';
import type { Policy } from '../src/types.js';
import type { CommandAudit } from '../src/command.js';

const policy: Policy = {
  organizationName: 'T', blockedLicenses: [], minScorecardScore: 0,
  blockVulnerabilities: true, minBlockingSeverity: 'MEDIUM', blockDeprecated: true, exceptionFormUrl: '',
};

const canned = (command: string): CommandAudit => ({
  detected: true, command, system: 'NPM', results: [],
  verdict: 'SAFE', effectiveVerdict: 'SAFE', overrides: [], remediation: [],
});

let dir: string;
let server: Server;
let calls = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hawkeye-daemon-'));
  process.env.HAWKEYE_DAEMON_SOCK = join(dir, 'd.sock');
  server = createDaemonServer(async ({ command }) => { calls++; return canned(command); });
  await new Promise<void>(res => server.listen(process.env.HAWKEYE_DAEMON_SOCK!, res));
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HAWKEYE_DAEMON_SOCK;
});

describe('daemon', () => {
  it('serves an audit over the socket', async () => {
    const a = await daemonAudit('npm install lodash', policy, []);
    expect(a?.command).toBe('npm install lodash');
    expect(a?.effectiveVerdict).toBe('SAFE');
  });

  it('memoizes identical requests — the handler runs once', async () => {
    calls = 0;
    await daemonAudit('npm install memo-x', policy, []);
    await daemonAudit('npm install memo-x', policy, []);
    expect(calls).toBe(1);
  });

  it('re-audits when policy differs (memo is keyed by policy)', async () => {
    calls = 0;
    await daemonAudit('npm install pol-y', policy, []);
    await daemonAudit('npm install pol-y', { ...policy, minBlockingSeverity: 'LOW' }, []);
    expect(calls).toBe(2);
  });

  it('returns null when no daemon is reachable (caller falls back)', async () => {
    const saved = process.env.HAWKEYE_DAEMON_SOCK;
    process.env.HAWKEYE_DAEMON_SOCK = join(dir, 'nonexistent.sock');
    const a = await daemonAudit('npm install z', policy, [], 500);
    expect(a).toBeNull();
    process.env.HAWKEYE_DAEMON_SOCK = saved;
  });
});
