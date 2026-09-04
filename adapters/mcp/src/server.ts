import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { HarnessError } from '../../../src/index.js';
import {
  checkActionInputSchema,
  nextActionInputSchema,
  submitResultInputSchema,
  toolOutputSchema,
} from './schemas.js';
import type { HawkeyeMcpService } from './service.js';
import type { HawkeyeMcpOutput } from './types.js';

const instructions = [
  'Use Hawkeye before any supported package-install action.',
  'Treat SAFE, BLOCKED, and UNKNOWN as canonical; never infer or override a verdict.',
  'The tools never execute package-manager commands.',
  'Carry the returned HawkeyeRunState into next-action and submit-result calls.',
  'A reported result or approval request is not permission to bypass normal enforcement.',
].join(' ');

function success(output: HawkeyeMcpOutput): CallToolResult {
  const structuredContent = JSON.parse(JSON.stringify(output)) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function failure(error: unknown): CallToolResult {
  const known = error instanceof HarnessError;
  const payload = {
    schemaVersion: 1,
    error: {
      code: known ? error.code : 'MCP_RUNTIME_ERROR',
      message: known ? error.message : 'Hawkeye could not verify this MCP request.',
    },
    safety: 'No approval was issued and no package-manager command was executed.',
  };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

async function safely(run: () => HawkeyeMcpOutput | Promise<HawkeyeMcpOutput>): Promise<CallToolResult> {
  try {
    return success(await run());
  } catch (error) {
    return failure(error);
  }
}

export function createHawkeyeMcpServer(service: HawkeyeMcpService): McpServer {
  const server = new McpServer(
    { name: 'oss-hawkeye', version: '1.3.0' },
    { instructions },
  );

  server.registerTool('hawkeye_check_action', {
    title: 'Check package-install action',
    description: 'Assess one explicit package-install command with canonical Hawkeye policy. Returns state and the next legal action; never executes the command.',
    inputSchema: checkActionInputSchema,
    outputSchema: toolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, ({ command, maxAttempts }) => safely(() => service.checkAction(command, maxAttempts)));

  server.registerTool('hawkeye_next_action', {
    title: 'Plan next Hawkeye action',
    description: 'Validate a carried HawkeyeRunState and return its deterministic next legal action. Does not execute or approve anything.',
    inputSchema: nextActionInputSchema,
    outputSchema: toolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({ state }) => safely(() => service.getNextAction(state)));

  server.registerTool('hawkeye_submit_result', {
    title: 'Submit external action result',
    description: 'Validate and immutably record the result for the exact pending action. Reporting a result never executes a command or grants approval.',
    inputSchema: submitResultInputSchema,
    outputSchema: toolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, ({ state, actionId, result }) => safely(() => service.submitActionResult({ state, actionId, result })));

  return server;
}
