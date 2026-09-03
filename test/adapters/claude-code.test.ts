import { describe, it, expect, vi, beforeEach } from 'vitest';

const auditInstall = vi.fn();
const formatBlockMessage = vi.fn(() => 'FORMATTED BLOCK MESSAGE');

vi.mock('../../adapters/lib/gate.mjs', () => ({ auditInstall, formatBlockMessage }));

// Importing (not spawning) the adapter — handle() is exported precisely so
// tests can drive it in-process, with no subprocess and no real stdin.
const { handle } = await import('../../adapters/claude-code.mjs');

function payload(command: string) {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

describe('claude-code adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a non-install command (gate returns null)', async () => {
    auditInstall.mockResolvedValue(null);

    const { exitCode, message } = await handle(payload('ls -la'));

    expect(exitCode).toBe(0);
    expect(message).toBe('');
  });

  it('allows an approved install (SAFE verdict)', async () => {
    auditInstall.mockResolvedValue({ effectiveVerdict: 'SAFE' });

    const { exitCode } = await handle(payload('npm install lodash'));

    expect(exitCode).toBe(0);
  });

  it('blocks a policy-violating install with exit 2 and the shared formatted message', async () => {
    auditInstall.mockResolvedValue({ effectiveVerdict: 'BLOCKED' });

    const { exitCode, message } = await handle(payload('npm install express@4.16.0'));

    expect(exitCode).toBe(2);
    expect(message).toBe('FORMATTED BLOCK MESSAGE');
    expect(formatBlockMessage).toHaveBeenCalledWith({ effectiveVerdict: 'BLOCKED' });
  });

  it('blocks an UNKNOWN (unverifiable) install the same as BLOCKED', async () => {
    auditInstall.mockResolvedValue({ effectiveVerdict: 'UNKNOWN' });

    const { exitCode } = await handle(payload('npm install lodash'));

    expect(exitCode).toBe(2);
  });

  it('fails closed (exit 2) when the gate throws', async () => {
    auditInstall.mockRejectedValue(new Error('boom'));

    const { exitCode, message } = await handle(payload('npm install lodash'));

    expect(exitCode).toBe(2);
    expect(message).toContain('could not verify');
    expect(message).toContain('boom');
  });

  it('does not interfere with non-JSON stdin', async () => {
    const { exitCode } = await handle('not json at all');

    expect(exitCode).toBe(0);
    expect(auditInstall).not.toHaveBeenCalled();
  });

  it('passes an empty command through faithfully when tool_input.command is missing', async () => {
    auditInstall.mockResolvedValue(null);

    await handle(JSON.stringify({ tool_name: 'Bash' }));

    expect(auditInstall).toHaveBeenCalledWith('');
  });
});
