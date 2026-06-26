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
 * Fail-closed: if a detected install cannot be verified — because Hawkeye
 * isn't runnable or it errored — we BLOCK rather than wave the install
 * through. A security gate that fails open is no gate at all.
 *
 * HAWKEYE_BIN overrides the CLI and MAY include arguments, so a local dev
 * build works: HAWKEYE_BIN="node /abs/path/to/dist/cli.js". It is split on
 * whitespace, so the executable's own path must not contain spaces.
 */
import { execFileSync } from 'node:child_process';

// Split so `HAWKEYE_BIN="node /abs/cli.js"` resolves to an executable + its
// args — not a single (non-existent) file literally named "node /abs/cli.js".
const [BIN, ...BIN_ARGS] = (process.env.HAWKEYE_BIN || 'hawkeye').trim().split(/\s+/);

// Cheap pre-filter for commands that look like a package INSTALL. This mirrors
// the CLI parser's install verbs; the CLI stays the authority (a false match
// here just makes it report "nothing to audit" → allowed). It must never be
// TIGHTER than the parser, or a real install would slip past the gate.
const INSTALL_RE =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b|\bpip3?\s+install\b|\bcargo\s+add\b|\bgo\s+get\b|\bgem\s+install\b|\bdotnet\b[\s\S]*\bpackage\b|\bmvn\b[\s\S]*-Dartifact=/i;

let raw = '';
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    process.exit(0); // not a hook payload we understand — don't interfere
  }

  // Not an install command → nothing to gate.
  if (!INSTALL_RE.test(command)) process.exit(0);

  try {
    // exit 0 → approved (or the CLI parsed no package to audit) → allow.
    execFileSync(BIN, [...BIN_ARGS, 'check-command', command], { stdio: 'pipe' });
    process.exit(0);
  } catch (err) {
    const detail = `${err?.stdout ?? ''}${err?.stderr ?? ''}`.trim();
    if (err && err.status === 1) {
      // exit 1 → BLOCKED / unverifiable → deny and explain to the agent.
      console.error(
        `🎾 Hawkeye blocked this install (supply-chain policy):\n\n${detail}\n\n` +
          `If a safe version is suggested above, retry the install with that exact ` +
          `version. Otherwise pick a safe alternative, or proceed only with an ` +
          `explicit, documented exception.`
      );
      process.exit(2);
    }
    // Hawkeye itself could not run (not installed, wrong HAWKEYE_BIN, crash).
    // We detected an install but cannot verify it → fail closed, don't wave
    // it through.
    console.error(
      `🎾 Hawkeye could not verify this install, so it was blocked (fail-closed).\n` +
        `Ensure the \`hawkeye\` CLI is installed, or that HAWKEYE_BIN points at a build.\n` +
        (detail ? `\n${detail}\n` : '')
    );
    process.exit(2);
  }
});
