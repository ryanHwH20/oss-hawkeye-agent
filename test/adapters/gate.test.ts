import { describe, it, expect, vi, beforeEach } from 'vitest';

// gate.mjs imports these by the same relative depth from repo root as this
// test file (adapters/lib/*.mjs and test/adapters/*.test.ts are both two
// directories deep), so the same relative specifier resolves to the same
// physical dist/ file here and in the module under test.
const auditCommand = vi.fn();
const loadPolicy = vi.fn(() => ({}));
const loadExceptions = vi.fn(() => []);
const daemonAudit = vi.fn(async () => null);
const recordAudit = vi.fn();
const formatInstallPlan = vi.fn(() => 'INSTALL PLAN TABLE');

vi.mock('../../dist/command.js', () => ({ auditCommand }));
vi.mock('../../dist/policy.js', () => ({ loadPolicy }));
vi.mock('../../dist/util/exceptions.js', () => ({ loadExceptions }));
vi.mock('../../dist/daemon-client.js', () => ({ daemonAudit }));
vi.mock('../../dist/util/audit-log.js', () => ({ recordAudit }));
vi.mock('../../dist/formatter.js', () => ({ formatInstallPlan }));

const { auditInstall, formatBlockMessage, INSTALL_RE } = await import('../../adapters/lib/gate.mjs');

function fixtureAudit(overrides: Record<string, unknown> = {}) {
  return {
    detected: true,
    command: 'npm install express@4.16.0',
    system: 'NPM',
    results: [
      {
        system: 'NPM',
        name: 'express',
        version: '4.16.0',
        verdict: 'BLOCKED',
        violations: [{ type: 'vulnerability', severity: 'HIGH', reason: 'Known Vulnerability' }],
        unverified: [],
      },
    ],
    verdict: 'BLOCKED',
    effectiveVerdict: 'BLOCKED',
    overrides: [],
    remediation: [],
    ...overrides,
  };
}

describe('gate.auditInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    daemonAudit.mockResolvedValue(null);
  });

  it('returns null for a non-install command, without touching policy or exceptions', async () => {
    const result = await auditInstall('ls -la');
    expect(result).toBeNull();
    expect(loadPolicy).not.toHaveBeenCalled();
    expect(loadExceptions).not.toHaveBeenCalled();
    expect(auditCommand).not.toHaveBeenCalled();
  });

  it('returns null for non-install package-manager commands (npm ci, go build)', async () => {
    expect(await auditInstall('npm ci')).toBeNull();
    expect(await auditInstall('go build ./...')).toBeNull();
  });

  it('audits a SAFE install and records "allow" telemetry', async () => {
    const audit = fixtureAudit({ effectiveVerdict: 'SAFE', verdict: 'SAFE' });
    auditCommand.mockResolvedValue(audit);

    const result = await auditInstall('npm install lodash');

    expect(result).toBe(audit);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'allow' }));
  });

  it('audits a BLOCKED install and records "block" telemetry', async () => {
    const audit = fixtureAudit();
    auditCommand.mockResolvedValue(audit);

    const result = await auditInstall('npm install express@4.16.0');

    expect(result.effectiveVerdict).toBe('BLOCKED');
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'block' }));
  });

  it('records "override" telemetry when a documented exception allows a non-passing package', async () => {
    const audit = fixtureAudit({
      effectiveVerdict: 'SAFE',
      overrides: [{ name: 'express', version: '4.16.0', originalVerdict: 'BLOCKED', reason: 'accepted risk' }],
    });
    auditCommand.mockResolvedValue(audit);

    await auditInstall('npm install express@4.16.0');

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'override' }));
  });

  it('treats UNKNOWN the same as BLOCKED for the caller (never SAFE)', async () => {
    const audit = fixtureAudit({ effectiveVerdict: 'UNKNOWN', verdict: 'UNKNOWN' });
    auditCommand.mockResolvedValue(audit);

    const result = await auditInstall('npm install lodash');

    expect(result.effectiveVerdict).not.toBe('SAFE');
  });

  it('prefers a daemon result over an in-process audit when the daemon is reachable', async () => {
    const daemonResult = fixtureAudit({ effectiveVerdict: 'SAFE' });
    daemonAudit.mockResolvedValue(daemonResult);

    const result = await auditInstall('npm install lodash');

    expect(result).toBe(daemonResult);
    expect(auditCommand).not.toHaveBeenCalled();
  });
});

describe('gate.formatBlockMessage', () => {
  it('includes the shared install-plan formatting and remediation guidance', () => {
    const msg = formatBlockMessage(fixtureAudit());
    expect(msg).toContain('Hawkeye blocked this install');
    expect(msg).toContain('INSTALL PLAN TABLE');
    expect(msg).toContain('documented exception');
  });
});

describe('INSTALL_RE', () => {
  it('matches common install verbs across ecosystems', () => {
    const installs = [
      'npm install lodash', 'npm i express', 'pnpm add axios', 'yarn add left-pad',
      'bun add zod', 'pip install requests', 'pip3 install requests', 'cargo add serde',
      'go get github.com/x/y', 'gem install rails',
    ];
    for (const cmd of installs) expect(INSTALL_RE.test(cmd)).toBe(true);
  });

  it('does not match unrelated or non-install package-manager commands', () => {
    const nonInstalls = ['ls -la', 'npm ci', 'npm run build', 'git status', 'go build ./...', 'cat package.json'];
    for (const cmd of nonInstalls) expect(INSTALL_RE.test(cmd)).toBe(false);
  });
});
