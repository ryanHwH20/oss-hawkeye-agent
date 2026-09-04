import type * as vscode from 'vscode';
import { createDefaultChatService } from './runtime.js';
import type { HawkeyeChatService } from './service.js';
import type { HawkeyeStateStore } from './types.js';

export const PARTICIPANT_ID = 'oss-hawkeye.chat';
export const STATE_KEY = 'oss-hawkeye.latest-run.v1';

class WorkspaceStateStore implements HawkeyeStateStore {
  constructor(private readonly state: vscode.Memento) {}

  async load(): Promise<unknown> {
    return this.state.get<unknown>(STATE_KEY);
  }

  async save(state: import('../../../src/index.js').HawkeyeRunState): Promise<void> {
    await this.state.update(STATE_KEY, state);
  }
}

type ServiceFactory = (store: HawkeyeStateStore, fallbackPolicyPath: string) => HawkeyeChatService;

/** Host-only registration. Security and workflow semantics stay in ChatService. */
export function registerHawkeyeParticipant(
  api: Pick<typeof vscode, 'chat' | 'workspace' | 'Uri'>,
  context: vscode.ExtensionContext,
  serviceFactory: ServiceFactory = (store, fallbackPolicyPath) =>
    createDefaultChatService(store, { fallbackPolicyPath }),
): vscode.Disposable {
  const store = new WorkspaceStateStore(context.workspaceState);
  const service = serviceFactory(store, context.asAbsolutePath('policy.json'));
  const participant = api.chat.createChatParticipant(PARTICIPANT_ID, async (
    request,
    _chatContext,
    stream,
    token,
  ) => {
    const cwd = api.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    stream.progress('Hawkeye is evaluating the request…');
    const response = await service.handle({
      command: request.command,
      prompt: request.prompt,
      cwd,
      isCancellationRequested: () => token.isCancellationRequested,
    });
    // Passing a string keeps command URI trust disabled.
    stream.markdown(response.markdown);
    return { metadata: { operation: response.operation, status: response.status } };
  });
  participant.iconPath = api.Uri.joinPath(context.extensionUri, 'icon.png');
  context.subscriptions.push(participant);
  return participant;
}
