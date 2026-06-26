import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordAudit, type AuditEntry } from '../src/util/audit-log.js';

const entry = (decision: AuditEntry['decision']): AuditEntry => ({
  ts: '2026-06-01T00:00:00.000Z',
  event: 'check-command',
  command: 'npm install x',
  system: 'NPM',
  decision,
  verdict: 'BLOCKED',
  packages: [{ name: 'x', version: '1.0.0', verdict: 'BLOCKED' }],
});

afterEach(() => delete process.env.HAWKEYE_AUDIT_LOG);

describe('recordAudit', () => {
  it('appends one JSONL record per call when HAWKEYE_AUDIT_LOG is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hawkeye-audit-'));
    const log = join(dir, 'nested', 'audit.jsonl'); // nested dir is created
    process.env.HAWKEYE_AUDIT_LOG = log;

    recordAudit(entry('block'));
    recordAudit(entry('override'));

    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).decision).toBe('block');
    expect(JSON.parse(lines[1]).decision).toBe('override');

    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op when HAWKEYE_AUDIT_LOG is unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hawkeye-audit-'));
    const log = join(dir, 'audit.jsonl');
    // env not set
    recordAudit(entry('allow'));
    expect(existsSync(log)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
