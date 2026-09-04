import * as vscode from 'vscode';
import { registerHawkeyeParticipant } from './host.js';

export function activate(context: vscode.ExtensionContext): void {
  registerHawkeyeParticipant(vscode, context);
}

export function deactivate(): void {}
