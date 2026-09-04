import type { HawkeyeChatCommand, HawkeyeChatOperation } from './types.js';

const commands = new Set<HawkeyeChatCommand>([
  'check', 'scan', 'explain', 'fix', 'policy', 'status',
]);

const installCommand = /(?:^|\s)((?:npm\s+(?:install|i)|pnpm\s+add|yarn\s+add|bun\s+add|pip3?\s+install|cargo\s+add|go\s+get|gem\s+install|dotnet\s+add\s+package|mvn\s+dependency:get)\b[^\n]*)/i;

export interface RoutedRequest {
  operation: HawkeyeChatOperation;
  argument: string;
}

/** Extracts an explicit install command without guessing a package ecosystem. */
export function extractInstallCommand(prompt: string): string | null {
  const match = prompt.match(installCommand)?.[1]?.trim();
  if (!match) return null;
  return match.replace(/[?。]+$/, '').trim();
}

/** Deterministic routing; unknown or ambiguous text becomes help. */
export function routeRequest(command: string | undefined, prompt: string): RoutedRequest {
  const normalized = command?.trim().toLowerCase();
  if (normalized && commands.has(normalized as HawkeyeChatCommand)) {
    return { operation: normalized as HawkeyeChatCommand, argument: prompt.trim() };
  }

  const explicit = extractInstallCommand(prompt);
  if (explicit) return { operation: 'check', argument: explicit };

  const text = prompt.trim().toLowerCase();
  if (/\b(scan|audit)\b.*\b(workspace|project|repository|repo)\b/.test(text)) {
    return { operation: 'scan', argument: '' };
  }
  if (/\b(why|explain)\b/.test(text)) return { operation: 'explain', argument: '' };
  if (/\b(fix|remediation|safe version)\b/.test(text)) return { operation: 'fix', argument: '' };
  if (/\b(policy|rules?)\b/.test(text)) return { operation: 'policy', argument: '' };
  if (/\b(status|what next|next action|what should i do next)\b/.test(text)) {
    return { operation: 'status', argument: '' };
  }
  return { operation: 'help', argument: prompt.trim() };
}
