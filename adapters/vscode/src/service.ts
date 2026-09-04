import type { AdmissionDecision, HawkeyeRunState } from '../../../src/index.js';
import {
  renderAssessment,
  renderExplanation,
  renderFailure,
  renderFix,
  renderHelp,
  renderPolicy,
  renderScan,
  renderStatus,
} from './render.js';
import { extractInstallCommand, routeRequest } from './router.js';
import type {
  HawkeyeChatDependencies,
  HawkeyeChatRequest,
  HawkeyeChatResponse,
  HawkeyeStateStore,
} from './types.js';

function responseStatus(verdict: string): HawkeyeChatResponse['status'] {
  if (verdict === 'SAFE') return 'ok';
  if (verdict === 'BLOCKED') return 'blocked';
  return 'unknown';
}

export class MemoryStateStore implements HawkeyeStateStore {
  private value: unknown;

  async load(): Promise<unknown> {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }

  async save(state: HawkeyeRunState): Promise<void> {
    this.value = structuredClone(state);
  }
}

export class HawkeyeChatService {
  constructor(
    private readonly store: HawkeyeStateStore,
    private readonly dependencies: HawkeyeChatDependencies,
  ) {}

  private cancelled(request: HawkeyeChatRequest): boolean {
    return request.isCancellationRequested?.() === true;
  }

  private cancellation(operation: HawkeyeChatResponse['operation']): HawkeyeChatResponse {
    return {
      operation,
      status: 'cancelled',
      markdown: 'Hawkeye assessment cancelled. No workflow state was saved and no dependency command was executed.',
    };
  }

  private async loadState(): Promise<HawkeyeRunState | null> {
    const value = await this.store.load();
    if (value === undefined || value === null) return null;
    // nextAction performs the Harness runtime schema/integrity validation.
    this.dependencies.nextAction(value as HawkeyeRunState);
    return value as HawkeyeRunState;
  }

  private async check(request: HawkeyeChatRequest, argument: string): Promise<HawkeyeChatResponse> {
    const command = extractInstallCommand(argument) ?? argument.trim();
    if (!command) return { operation: 'check', status: 'help', markdown: renderHelp('/check') };

    const loaded = this.dependencies.loadPolicyWithMetadata(request.cwd);
    const intent = { kind: 'shell_command' as const, command, cwd: request.cwd };
    const state = this.dependencies.createRun(intent, loaded.ref, {
      runId: this.dependencies.runId(),
      now: this.dependencies.now,
    });
    const assessPlan = this.dependencies.nextAction(state);
    if (!assessPlan || assessPlan.kind !== 'ASSESS') {
      throw new Error('A new Harness run did not request assessment.');
    }
    if (this.cancelled(request)) return this.cancellation('check');
    const assessment = await this.dependencies.assessAction(intent, { policy: loaded.policy });
    if (this.cancelled(request)) return this.cancellation('check');
    const updated = this.dependencies.submitResult(state, assessPlan.id, {
      schemaVersion: 1,
      kind: 'ASSESSMENT_COMPLETED',
      assessment,
      completedAt: this.dependencies.now().toISOString(),
    });

    if (assessment.applicability === 'not_applicable') {
      return {
        operation: 'check', status: 'help', state: updated,
        markdown: renderAssessment(assessment, updated, null),
      };
    }
    if (this.cancelled(request)) return this.cancellation('check');
    await this.store.save(updated);
    return {
      operation: 'check',
      status: responseStatus(assessment.decision.effectiveVerdict),
      state: updated,
      markdown: renderAssessment(assessment, updated, this.dependencies.nextAction(updated)),
    };
  }

  private async status(): Promise<HawkeyeChatResponse> {
    const state = await this.loadState();
    if (!state) return { operation: 'status', status: 'help', markdown: renderHelp('No current run') };
    const decision = state.decisions[state.decisions.length - 1];
    return {
      operation: 'status', status: decision ? responseStatus(decision.effectiveVerdict) : 'ok', state,
      markdown: renderStatus(state, this.dependencies.nextAction(state)),
    };
  }

  private async explain(): Promise<HawkeyeChatResponse> {
    const state = await this.loadState();
    const decision: AdmissionDecision | undefined = state?.decisions[state.decisions.length - 1];
    if (!state || !decision) {
      return { operation: 'explain', status: 'help', markdown: renderHelp('No assessed decision') };
    }
    return {
      operation: 'explain', status: responseStatus(decision.effectiveVerdict), state,
      markdown: renderExplanation(decision),
    };
  }

  private async fix(): Promise<HawkeyeChatResponse> {
    const state = await this.loadState();
    if (!state) return { operation: 'fix', status: 'help', markdown: renderHelp('No current run') };
    const action = this.dependencies.nextAction(state);
    const decision = state.decisions[state.decisions.length - 1];
    return {
      operation: 'fix',
      status: action?.kind === 'TRY_VERIFIED_REMEDIATION'
        ? responseStatus(decision?.effectiveVerdict ?? 'UNKNOWN')
        : 'help',
      state,
      markdown: renderFix(action),
    };
  }

  async handle(request: HawkeyeChatRequest): Promise<HawkeyeChatResponse> {
    const routed = routeRequest(request.command, request.prompt);
    if (this.cancelled(request)) return this.cancellation(routed.operation);
    try {
      switch (routed.operation) {
        case 'check': return await this.check(request, routed.argument);
        case 'status': return await this.status();
        case 'explain': return await this.explain();
        case 'fix': return await this.fix();
        case 'policy': {
          const loaded = this.dependencies.loadPolicyWithMetadata(request.cwd);
          return { operation: 'policy', status: 'ok', markdown: renderPolicy(loaded) };
        }
        case 'scan': {
          const loaded = this.dependencies.loadPolicyWithMetadata(request.cwd);
          const report = await this.dependencies.scanProject(request.cwd, loaded.policy);
          if (this.cancelled(request)) return this.cancellation('scan');
          return {
            operation: 'scan', status: responseStatus(report.verdict),
            markdown: renderScan(report),
          };
        }
        default:
          return { operation: 'help', status: 'help', markdown: renderHelp(routed.argument) };
      }
    } catch (error) {
      return { operation: routed.operation, status: 'error', markdown: renderFailure(error) };
    }
  }
}
