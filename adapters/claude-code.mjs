#!/usr/bin/env node
/**
 * Hawkeye install-gate adapter for Claude Code's PreToolUse hook.
 *
 * Gates AI-agent package installs through Hawkeye *before* the command runs:
 * when the agent tries to run `npm install <pkg>`, `pip install <pkg>`, etc.,
 * this adapter audits the package(s) and blocks the command if the verdict is
 * BLOCKED or UNKNOWN (fail-closed).
 *
 * Wire it up in ~/.claude/settings.json — see docs/INTEGRATIONS.md.
 *
 * Contract (Claude Code PreToolUse):
 *   stdin  : JSON with { tool_name, tool_input: { command } }
 *   exit 0 : allow the tool call
 *   exit 2 : block the tool call; stderr is shown to the agent
 *
 * All decision logic (what counts as an install, whether it's SAFE, how to
 * describe a block) lives in ./lib/gate.mjs, shared with every other
 * adapter. This file only translates Claude Code's wire format to/from it.
 */
import { auditInstall, formatBlockMessage } from './lib/gate.mjs';

/**
 * Pure translation: Claude Code's PreToolUse stdin payload -> an exit
 * decision. Exported separately from the stdin/exit glue below so tests can
 * call it in-process, with no subprocess spawn.
 */
export async function handle(rawStdin) {
  let command = '';
  try {
    command = JSON.parse(rawStdin)?.tool_input?.command ?? '';
  } catch {
    return { exitCode: 0, message: '' }; // not a hook payload we understand — don't interfere
  }

  try {
    const audit = await auditInstall(command);
    if (!audit || audit.effectiveVerdict === 'SAFE') return { exitCode: 0, message: '' };
    return { exitCode: 2, message: formatBlockMessage(audit) };
  } catch (err) {
    // Hawkeye itself could not complete the audit (bad policy file, unexpected
    // crash, ...). We detected an install but cannot verify it → fail closed,
    // don't wave it through. A security gate that fails open is no gate.
    const detail = err?.message ?? String(err);
    return {
      exitCode: 2,
      message: `🎾 Hawkeye could not verify this install, so it was blocked (fail-closed).\n${detail}\n`,
    };
  }
}

// Only run the stdin/exit glue when executed directly (`node claude-code.mjs`),
// not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = '';
  process.stdin.on('data', chunk => (raw += chunk));
  process.stdin.on('end', async () => {
    const { exitCode, message } = await handle(raw);
    if (message) console.error(message);
    process.exit(exitCode);
  });
}
