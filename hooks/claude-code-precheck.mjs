#!/usr/bin/env node
/**
 * Hawkeye PreToolUse hook for Claude Code.
 *
 * Gates AI-agent package installs through Hawkeye *before* the command runs:
 * when the agent tries to run `npm install <pkg>`, `pip install <pkg>`, etc.,
 * this hook audits the package(s) and blocks the command if the verdict is
 * BLOCKED or UNVERIFIED (fail-closed).
 *
 * Wire it up in ~/.claude/settings.json — see docs/INTEGRATIONS.md.
 *
 * Contract (Claude Code PreToolUse):
 *   stdin  : JSON with { tool_name, tool_input: { command } }
 *   exit 0 : allow the tool call
 *   exit 2 : block the tool call; stderr is shown to the agent
 *
 * Override the CLI with HAWKEYE_BIN (e.g. point at a local dev build).
 */
import { execFileSync } from 'node:child_process';

const BIN = process.env.HAWKEYE_BIN || 'hawkeye';

let raw = '';
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    process.exit(0); // not JSON we understand — don't interfere
  }

  // Fast path: only bother for commands that mention a package manager.
  if (!/\b(npm|pnpm|yarn|bun|pip3?|cargo|gem|go|dotnet|mvn)\b/.test(command)) {
    process.exit(0);
  }

  try {
    // exit 0 → approved, or not an install command → allow.
    execFileSync(BIN, ['check-command', command], { stdio: 'pipe' });
    process.exit(0);
  } catch (err) {
    if (err && err.status === 1) {
      // exit 1 → blocked / unverifiable → deny and explain to the agent.
      const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
      console.error(
        `🎾 Hawkeye blocked this install (supply-chain policy):\n\n${detail}\n\n` +
          `Pick a safe alternative, or proceed only with an explicit, documented exception.`
      );
      process.exit(2);
    }
    // Tool error (exit 2) or missing binary → don't break the workflow.
    process.exit(0);
  }
});
