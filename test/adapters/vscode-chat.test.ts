import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  ActionAssessment,
  AdmissionDecision,
  HawkeyeRunState,
  LoadedPolicy,
  Policy,
  ScanReport,
} from '../../src/index.js';
import { createRun, nextAction, submitResult } from '../../src/index.js';
import { registerHawkeyeParticipant } from '../../adapters/vscode/src/host.js';
import { extractInstallCommand, routeRequest } from '../../adapters/vscode/src/router.js';
import { HawkeyeChatService, MemoryStateStore } from '../../adapters/vscode/src/service.js';
import type { HawkeyeChatDependencies, HawkeyeStateStore } from '../../adapters/vscode/src/types.js';

const time = '2026-09-04T01:00:00.000Z';
const policy: Policy = {
  organizationName: 'Test Org',
  blockedLicenses: ['GPL-3.0-only'],
  minScorecardScore: 4,
  blockVulnerabilities: true,
  minBlockingSeverity: 'MEDIUM',
  blockDeprecated: true,
  blockTyposquats: true,
  exceptionFormUrl: 'https://example.test/exceptions',
  ai: null,
};
const loadedPolicy: LoadedPolicy = {
  policy,
  ref: { id: 'Test Org', digest: 'sha256:test-policy' },
  source: { kind: 'workspace', path: '/private/workspace/.audit-agent.yaml' },
};

const ecosystemCases = [
  {
    label: 'NPM', system: 'NPM', name: 'lodash', current: '4.17.20', fixed: '4.17.21',
    command: 'npm install lodash@4.17.20', fix: 'npm install lodash@4.17.21',
  },
  {
    label: 'PyPI', system: 'PYPI', name: 'requests', current: '2.31.0', fixed: '2.32.3',
    command: 'pip install requests==2.31.0', fix: 'pip install requests==2.32.3',
  },
  {
    label: 'Cargo', system: 'CARGO', name: 'serde', current: '1.0.200', fixed: '1.0.204',
    command: 'cargo add serde@1.0.200', fix: 'cargo add serde@1.0.204',
  },
  {
    label: 'Go', system: 'GO', name: 'github.com/google/uuid', current: 'v1.5.0', fixed: 'v1.6.0',
    command: 'go get github.com/google/uuid@v1.5.0', fix: 'go get github.com/google/uuid@v1.6.0',
  },
  {
    label: 'RubyGems', system: 'RUBYGEMS', name: 'rake', current: '13.1.0', fixed: '13.2.1',
    command: 'gem install rake -v 13.1.0', fix: 'gem install rake -v 13.2.1',
  },
  {
    label: 'NuGet', system: 'NUGET', name: 'Newtonsoft.Json', current: '13.0.2', fixed: '13.0.3',
    command: 'dotnet add package Newtonsoft.Json --version 13.0.2',
    fix: 'dotnet add package Newtonsoft.Json --version 13.0.3',
  },
  {
    label: 'Maven', system: 'MAVEN', name: 'org.slf4j:slf4j-api', current: '2.0.12', fixed: '2.0.13',
    command: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.12',
    fix: 'mvn dependency:get -Dartifact=org.slf4j:slf4j-api:2.0.13',
  },
] as const;

function decisionFor(
  item: typeof ecosystemCases[number],
  kind: 'safe' | 'remediation' = 'safe',
): AdmissionDecision {
  const subject = { kind: 'shell_command' as const, command: item.command, cwd: '/repo' };
  return {
    schemaVersion: 1,
    id: `decision-${item.system}-${kind}`,
    subject,
    packages: [{
      system: item.system, name: item.name,
      requestedVersion: item.current, resolvedVersion: item.current,
    }],
    rawVerdict: kind === 'safe' ? 'SAFE' : 'BLOCKED',
    effectiveVerdict: kind === 'safe' ? 'SAFE' : 'BLOCKED',
    findings: kind === 'safe' ? [] : [{
      id: 'finding-1', subject: {
        system: item.system, name: item.name,
        requestedVersion: item.current, resolvedVersion: item.current,
      },
      category: 'VULNERABILITY', severity: 'HIGH', effect: 'blocking',
      title: 'Known vulnerability', details: ['CVE-2026-0001'], explanation: 'Upgrade required.',
    }],
    evidence: [], errors: [], overrides: [],
    remediation: kind === 'safe' ? [] : [{
      system: item.system, name: item.name, current: item.current,
      action: 'upgrade', recommendedVersion: item.fixed, fix: item.fix,
      verified: true, reason: 'The fixed version passed normal admission checks.',
    }],
    policy: loadedPolicy.ref,
    decidedAt: time,
  };
}

function assessmentFor(
  item: typeof ecosystemCases[number],
  kind: 'safe' | 'remediation' = 'safe',
): ActionAssessment {
  const decision = decisionFor(item, kind);
  return {
    schemaVersion: 1,
    applicability: 'applicable',
    decision,
    nextAction: kind === 'safe' ? {
      id: `${decision.id}:next`, kind: 'EXECUTE_ALLOWED_ACTION', command: item.command,
      expectedResult: 'enforcement then execution',
    } : {
      id: `${decision.id}:next`, kind: 'TRY_VERIFIED_REMEDIATION', command: item.fix,
      package: {
        system: item.system, name: item.name,
        requestedVersion: item.current, resolvedVersion: item.fixed,
      },
      expectedResult: 'enforcement then remediation',
    },
  };
}

function dependencies(assessment: ActionAssessment): HawkeyeChatDependencies & {
  assessAction: ReturnType<typeof vi.fn>;
  scanProject: ReturnType<typeof vi.fn>;
} {
  let tick = 0;
  return {
    loadPolicyWithMetadata: vi.fn(() => loadedPolicy),
    assessAction: vi.fn(async () => assessment),
    scanProject: vi.fn(async () => ({
      path: '/repo', manifests: [], results: [], verdict: 'SAFE', weakIntegrity: [],
    } satisfies ScanReport)),
    createRun,
    nextAction,
    submitResult,
    now: () => new Date(Date.parse(time) + tick++ * 1000),
    runId: () => 'chat-run',
  };
}

describe('@oss-hawkeye request router', () => {
  it.each(ecosystemCases)('extracts the exact $label install command', ({ command }) => {
    expect(extractInstallCommand(`Can Hawkeye check ${command}?`)).toBe(command);
    expect(routeRequest(undefined, `Can Hawkeye check ${command}?`)).toEqual({
      operation: 'check', argument: command,
    });
  });

  it('uses slash commands as explicit operations', () => {
    for (const command of ['check', 'scan', 'explain', 'fix', 'policy', 'status']) {
      expect(routeRequest(command, 'argument').operation).toBe(command);
    }
  });

  it('routes clear workflow phrases without an LLM', () => {
    expect(routeRequest(undefined, 'scan this workspace').operation).toBe('scan');
    expect(routeRequest(undefined, 'why was it blocked?').operation).toBe('explain');
    expect(routeRequest(undefined, 'give me a safe version').operation).toBe('fix');
    expect(routeRequest(undefined, 'show company policy').operation).toBe('policy');
    expect(routeRequest(undefined, 'what should I do next?').operation).toBe('status');
  });

  it('asks for clarification instead of assuming that a bare package is NPM', () => {
    expect(routeRequest(undefined, 'axios')).toEqual({ operation: 'help', argument: 'axios' });
  });
});

describe('@oss-hawkeye chat service', () => {
  it.each(ecosystemCases)('checks and persists an exact SAFE $label action', async item => {
    const store = new MemoryStateStore();
    const deps = dependencies(assessmentFor(item));
    const service = new HawkeyeChatService(store, deps);

    const response = await service.handle({ command: 'check', prompt: item.command, cwd: '/repo' });
    const stored = await store.load() as HawkeyeRunState;

    expect(response.status).toBe('ok');
    expect(response.markdown).toContain(`${item.system}:${item.name}@${item.current}`);
    expect(response.markdown).toContain('EXECUTE_ALLOWED_ACTION');
    expect(stored.intent.command).toBe(item.command);
    expect(stored.policy.digest).toBe(loadedPolicy.ref.digest);
    expect(stored.decisions[0]?.packages[0]).toMatchObject({
      system: item.system, name: item.name,
      requestedVersion: item.current, resolvedVersion: item.current,
    });
    expect(nextAction(JSON.parse(JSON.stringify(stored)))?.kind).toBe('EXECUTE_ALLOWED_ACTION');
  });

  it.each(ecosystemCases)('renders only a verified $label remediation', async item => {
    const store = new MemoryStateStore();
    const service = new HawkeyeChatService(store, dependencies(assessmentFor(item, 'remediation')));

    const checked = await service.handle({ command: 'check', prompt: item.command, cwd: '/repo' });
    const fixed = await service.handle({ command: 'fix', prompt: '', cwd: '/repo' });

    expect(checked.status).toBe('blocked');
    expect(checked.markdown).toContain('TRY_VERIFIED_REMEDIATION');
    expect(fixed.status).toBe('blocked');
    expect(fixed.markdown).toContain(item.fix);
    expect(fixed.markdown).toContain('has not been executed');
  });

  it('reads the stored run for status and explanation', async () => {
    const item = ecosystemCases[0];
    const service = new HawkeyeChatService(new MemoryStateStore(), dependencies(assessmentFor(item)));
    await service.handle({ command: 'check', prompt: item.command, cwd: '/repo' });

    const status = await service.handle({ command: 'status', prompt: '', cwd: '/repo' });
    const explanation = await service.handle({ command: 'explain', prompt: '', cwd: '/repo' });

    expect(status.markdown).toContain('ready_to_execute');
    expect(status.markdown).toContain('EXECUTE_ALLOWED_ACTION');
    expect(explanation.markdown).toContain('Why Hawkeye returned');
    expect(explanation.markdown).toContain('Effective verdict: **SAFE**');
  });

  it('does not expose the absolute policy source path', async () => {
    const item = ecosystemCases[0];
    const service = new HawkeyeChatService(new MemoryStateStore(), dependencies(assessmentFor(item)));
    const response = await service.handle({ command: 'policy', prompt: '', cwd: '/repo' });

    expect(response.markdown).toContain('Policy source: **workspace**');
    expect(response.markdown).not.toContain('/private/workspace');
  });

  it('routes scan through the existing runtime and discloses manifest coverage', async () => {
    const item = ecosystemCases[0];
    const deps = dependencies(assessmentFor(item));
    deps.scanProject.mockResolvedValue({
      path: '/repo', manifests: ['/repo/package.json'], results: [],
      verdict: 'SAFE', weakIntegrity: [],
    });
    const service = new HawkeyeChatService(new MemoryStateStore(), deps);

    const response = await service.handle({ command: 'scan', prompt: '', cwd: '/repo' });

    expect(deps.scanProject).toHaveBeenCalledWith('/repo', policy);
    expect(response.markdown).toContain('package.json/lockfiles and requirements.txt');
    expect(response.markdown).toContain('all seven supported ecosystems');
  });

  it('does not persist an assessment cancelled while providers are running', async () => {
    const item = ecosystemCases[0];
    const store = new MemoryStateStore();
    const deps = dependencies(assessmentFor(item));
    let cancelled = false;
    deps.assessAction.mockImplementation(async () => {
      cancelled = true;
      return assessmentFor(item);
    });
    const service = new HawkeyeChatService(store, deps);

    const response = await service.handle({
      command: 'check', prompt: item.command, cwd: '/repo',
      isCancellationRequested: () => cancelled,
    });

    expect(response.status).toBe('cancelled');
    expect(await store.load()).toBeUndefined();
  });

  it('fails closed on malformed persisted state', async () => {
    const item = ecosystemCases[0];
    const store: HawkeyeStateStore = {
      load: async () => ({ schemaVersion: 1, phase: 'ready_to_execute', approved: true }),
      save: vi.fn(),
    };
    const service = new HawkeyeChatService(store, dependencies(assessmentFor(item)));

    const response = await service.handle({ command: 'status', prompt: '', cwd: '/repo' });

    expect(response.status).toBe('error');
    expect(response.markdown).toContain('could not verify');
    expect(response.markdown).toContain('No approval was issued');
  });

  it('fails closed instead of displaying a command from tampered remediation state', async () => {
    const item = ecosystemCases[0];
    const assessment = assessmentFor(item, 'remediation');
    const store = new MemoryStateStore();
    const service = new HawkeyeChatService(store, dependencies(assessment));
    await service.handle({ command: 'check', prompt: item.command, cwd: '/repo' });
    const state = await store.load() as HawkeyeRunState;
    if (!state.pendingAction) throw new Error('expected remediation');
    state.pendingAction.command = 'npm install attacker-controlled@1.0.0';
    await store.save(state);

    const response = await service.handle({ command: 'fix', prompt: '', cwd: '/repo' });

    expect(response.status).toBe('error');
    expect(response.markdown).not.toContain('attacker-controlled');
    expect(response.markdown).toContain('No approval was issued');
  });

  it('does not save not-applicable text as a current security decision', async () => {
    const item = ecosystemCases[0];
    const store = new MemoryStateStore();
    const deps = dependencies({
      schemaVersion: 1, applicability: 'not_applicable',
      subject: { kind: 'shell_command', command: 'npm test', cwd: '/repo' },
      reason: 'No supported package-install action was detected.',
    });
    const service = new HawkeyeChatService(store, deps);

    const response = await service.handle({ command: 'check', prompt: 'npm test', cwd: '/repo' });

    expect(response.status).toBe('help');
    expect(response.markdown).toContain('No `SAFE` verdict was issued');
    expect(await store.load()).toBeUndefined();
  });

  it('returns deterministic help for a bare package without calling assessment', async () => {
    const item = ecosystemCases[0];
    const deps = dependencies(assessmentFor(item));
    const service = new HawkeyeChatService(new MemoryStateStore(), deps);

    const response = await service.handle({ prompt: 'axios', cwd: '/repo' });

    expect(response.status).toBe('help');
    expect(response.markdown).toContain('could not safely infer an ecosystem');
    expect(deps.assessAction).not.toHaveBeenCalled();
  });
});

describe('VS Code host registration and manifest', () => {
  it('registers the exact participant and streams an untrusted string response', async () => {
    let handler: ((...args: any[]) => Promise<unknown>) | undefined;
    const participant = { dispose: vi.fn(), iconPath: undefined as unknown };
    const createChatParticipant = vi.fn((_id, value) => {
      handler = value;
      return participant;
    });
    const api = {
      chat: { createChatParticipant },
      workspace: { workspaceFolders: [{ uri: { fsPath: '/repo' } }] },
      Uri: { joinPath: vi.fn(() => ({ fsPath: '/extension/icon.png' })) },
    };
    const context = {
      workspaceState: { get: vi.fn(), update: vi.fn() },
      asAbsolutePath: vi.fn(() => '/extension/policy.json'),
      extensionUri: { fsPath: '/extension' },
      subscriptions: [] as unknown[],
    };
    const service = {
      handle: vi.fn(async () => ({
        operation: 'policy' as const, status: 'ok' as const, markdown: '# policy',
      })),
    };

    registerHawkeyeParticipant(
      api as never,
      context as never,
      () => service as never,
    );
    expect(createChatParticipant).toHaveBeenCalledWith('oss-hawkeye.chat', expect.any(Function));
    expect(context.subscriptions).toContain(participant);
    expect(participant.iconPath).toEqual({ fsPath: '/extension/icon.png' });

    const stream = { progress: vi.fn(), markdown: vi.fn() };
    await handler?.(
      { command: 'policy', prompt: '' }, {}, stream,
      { isCancellationRequested: false },
    );
    expect(stream.markdown).toHaveBeenCalledWith('# policy');
    expect(stream.markdown.mock.calls[0]?.[0]).toBeTypeOf('string');
  });

  it('declares @oss-hawkeye and all six commands in the extension manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve('adapters/vscode/package.json'), 'utf8'));
    const participant = manifest.contributes.chatParticipants[0];

    expect(participant.id).toBe('oss-hawkeye.chat');
    expect(participant.name).toBe('oss-hawkeye');
    expect(participant.isSticky).toBe(true);
    expect(participant.commands.map((item: { name: string }) => item.name)).toEqual([
      'check', 'scan', 'explain', 'fix', 'policy', 'status',
    ]);
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false);
  });

  it('does not import a shell execution API in the adapter source', () => {
    const files = ['extension.ts', 'host.ts', 'runtime.ts', 'service.ts', 'router.ts', 'render.ts'];
    for (const file of files) {
      const source = readFileSync(resolve('adapters/vscode/src', file), 'utf8');
      expect(source).not.toMatch(/node:child_process|execFile|\bspawn\s*\(/);
    }
  });
});
