import { randomUUID } from 'node:crypto';
import {
  assessAction,
  createRun,
  loadPolicyWithMetadata,
  nextAction,
  scanProject,
  submitResult,
} from '../../../src/index.js';
import { HawkeyeChatService, MemoryStateStore } from './service.js';
import type { HawkeyeStateStore } from './types.js';

export interface DefaultRuntimeOptions {
  fallbackPolicyPath: string;
  now?: () => Date;
  runId?: () => string;
}

export function createDefaultChatService(
  store: HawkeyeStateStore,
  options: DefaultRuntimeOptions,
): HawkeyeChatService {
  return new HawkeyeChatService(store, {
    loadPolicyWithMetadata: cwd => loadPolicyWithMetadata(cwd, options.fallbackPolicyPath),
    assessAction,
    scanProject,
    createRun,
    nextAction,
    submitResult,
    now: options.now ?? (() => new Date()),
    runId: options.runId ?? randomUUID,
  });
}

export { HawkeyeChatService, MemoryStateStore } from './service.js';
export { extractInstallCommand, routeRequest } from './router.js';
export type {
  HawkeyeChatCommand,
  HawkeyeChatDependencies,
  HawkeyeChatOperation,
  HawkeyeChatRequest,
  HawkeyeChatResponse,
  HawkeyeStateStore,
} from './types.js';

export function createMemoryChatService(options: DefaultRuntimeOptions): {
  service: HawkeyeChatService;
  store: MemoryStateStore;
} {
  const store = new MemoryStateStore();
  return { service: createDefaultChatService(store, options), store };
}
