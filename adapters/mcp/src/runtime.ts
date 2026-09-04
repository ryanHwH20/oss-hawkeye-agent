import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessAction,
  createRun,
  loadPolicyWithMetadata,
  nextAction,
  submitResult,
} from '../../../src/index.js';
import { HawkeyeMcpService } from './service.js';

function bundledPolicyPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../policy.json');
}

export function createDefaultMcpService(workspace = process.cwd()): HawkeyeMcpService {
  return new HawkeyeMcpService(workspace, {
    loadPolicyWithMetadata: cwd => loadPolicyWithMetadata(cwd, bundledPolicyPath()),
    createRun,
    nextAction,
    assessAction,
    submitResult,
    now: () => new Date(),
    runId: randomUUID,
  });
}
