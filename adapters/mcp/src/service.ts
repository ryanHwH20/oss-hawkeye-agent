import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { HarnessError } from '../../../src/index.js';
import {
  MAX_COMMAND_BYTES,
  MAX_RESULT_BYTES,
  MAX_STATE_BYTES,
} from './schemas.js';
import type { HawkeyeMcpDependencies, HawkeyeMcpOutput, SubmitResultInput } from './types.js';

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function assertSize(value: unknown, maximum: number, label: string): void {
  let size: number;
  try {
    size = jsonBytes(value);
  } catch {
    throw new HarnessError('INVALID_STATE', `${label} must be JSON serializable.`);
  }
  if (size > maximum) {
    throw new HarnessError('INVALID_STATE', `${label} exceeds the MCP payload limit.`);
  }
}

function statusFor(state: HawkeyeMcpOutput['state'], assessment?: HawkeyeMcpOutput['assessment']): HawkeyeMcpOutput['status'] {
  if (assessment?.applicability === 'not_applicable') return 'NOT_APPLICABLE';
  const decision = state.decisions[state.decisions.length - 1];
  return decision?.effectiveVerdict ?? 'WORKFLOW';
}

function summaryFor(output: Pick<HawkeyeMcpOutput, 'status' | 'state' | 'nextAction'>): string {
  const action = output.nextAction?.kind ?? 'NONE';
  return `Hawkeye ${output.status}; phase=${output.state.phase}; next=${action}. No package-manager command was executed.`;
}

export class HawkeyeMcpService {
  readonly workspace: string;

  constructor(workspace: string, private readonly dependencies: HawkeyeMcpDependencies) {
    this.workspace = resolve(workspace);
  }

  private validateCarriedState(state: HawkeyeMcpOutput['state']): void {
    assertSize(state, MAX_STATE_BYTES, 'HawkeyeRunState');
    if (!state.intent.cwd || resolve(state.intent.cwd) !== this.workspace) {
      throw new HarnessError('INVALID_STATE', 'HawkeyeRunState belongs to a different MCP workspace.');
    }
    this.dependencies.nextAction(state);
  }

  async checkAction(command: string, maxAttempts?: number): Promise<HawkeyeMcpOutput> {
    const normalized = command.trim();
    if (!normalized || Buffer.byteLength(normalized, 'utf8') > MAX_COMMAND_BYTES) {
      throw new HarnessError('INVALID_STATE', 'command is empty or exceeds the MCP payload limit.');
    }

    const loaded = this.dependencies.loadPolicyWithMetadata(this.workspace);
    const intent = { kind: 'shell_command' as const, command: normalized, cwd: this.workspace };
    const state = this.dependencies.createRun(intent, loaded.ref, {
      maxAttempts,
      runId: this.dependencies.runId(),
      now: this.dependencies.now,
    });
    const assess = this.dependencies.nextAction(state);
    if (!assess || assess.kind !== 'ASSESS') {
      throw new HarnessError('INVALID_STATE', 'A new MCP run did not request canonical assessment.');
    }

    const assessment = await this.dependencies.assessAction(intent, { policy: loaded.policy });
    const nextState = this.dependencies.submitResult(state, assess.id, {
      schemaVersion: 1,
      kind: 'ASSESSMENT_COMPLETED',
      assessment,
      completedAt: this.dependencies.now().toISOString(),
    });
    const nextAction = this.dependencies.nextAction(nextState);
    const status = statusFor(nextState, assessment);
    const output: HawkeyeMcpOutput = {
      schemaVersion: 1,
      status,
      summary: '',
      state: nextState,
      nextAction,
      assessment,
    };
    output.summary = summaryFor(output);
    assertSize(output.state, MAX_STATE_BYTES, 'HawkeyeRunState');
    return output;
  }

  getNextAction(state: HawkeyeMcpOutput['state']): HawkeyeMcpOutput {
    this.validateCarriedState(state);
    const nextAction = this.dependencies.nextAction(state);
    const status = statusFor(state);
    const output: HawkeyeMcpOutput = {
      schemaVersion: 1,
      status,
      summary: '',
      state: structuredClone(state),
      nextAction,
    };
    output.summary = summaryFor(output);
    return output;
  }

  submitActionResult(input: SubmitResultInput): HawkeyeMcpOutput {
    this.validateCarriedState(input.state);
    assertSize(input.result, MAX_RESULT_BYTES, 'ActionResult');
    const state = this.dependencies.submitResult(input.state, input.actionId, input.result);
    assertSize(state, MAX_STATE_BYTES, 'HawkeyeRunState');
    const nextAction = this.dependencies.nextAction(state);
    const status = statusFor(state);
    const output: HawkeyeMcpOutput = {
      schemaVersion: 1,
      status,
      summary: '',
      state,
      nextAction,
    };
    output.summary = summaryFor(output);
    return output;
  }
}
