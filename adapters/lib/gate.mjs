/**
 * Shared install-gate core, used by every per-tool adapter (Claude Code,
 * Cursor, Gemini CLI, ...). Each adapter only translates its host tool's
 * wire format to/from this module — the audit decision itself lives here,
 * once, so every tool sees the identical verdict and message.
 *
 * This imports the compiled audit primitives directly (no subprocess) —
 * see docs/INTEGRATIONS.md for why adapters no longer shell out to the
 * `hawkeye` binary the way the old hooks/claude-code-precheck.mjs did.
 */
import { auditCommand } from '../../dist/command.js';
import { loadPolicy } from '../../dist/policy.js';
import { loadExceptions } from '../../dist/util/exceptions.js';
import { daemonAudit } from '../../dist/daemon-client.js';
import { recordAudit } from '../../dist/util/audit-log.js';
import { formatInstallPlan } from '../../dist/formatter.js';

// Cheap pre-filter for commands that look like a package INSTALL. This mirrors
// the CLI parser's install verbs; the parser stays the authority (a false
// match here just makes auditInstall() report `detected: false` → allowed).
// It must never be TIGHTER than the parser, or a real install would slip past
// every adapter built on this module.
//
// Kept even though the network-calling part of an audit (deps.dev/OSV/
// Scorecard) is already gated separately by auditCommand()'s own
// detectAndParse() — this prefilter's job is narrower: skip loadPolicy()'s
// file read and loadExceptions()'s existsSync()/git checks for the many
// non-install Bash commands (ls, git status, cat, ...) a coding agent runs
// in a session, none of which need auditing at all.
export const INSTALL_RE =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b|\bpip3?\s+install\b|\bcargo\s+add\b|\bgo\s+get\b|\bgem\s+install\b|\bdotnet\b[\s\S]*\bpackage\b|\bmvn\b[\s\S]*-Dartifact=/i;

/**
 * Audit a shell command for a package install. Returns `null` when the
 * command doesn't look like an install — callers should treat that as an
 * immediate allow, with no further Hawkeye involvement. Otherwise returns
 * the same `CommandAudit` shape `hawkeye check-command` produces (see
 * src/command.ts), for the caller to turn into its own allow/deny decision.
 */
export async function auditInstall(command) {
  if (!INSTALL_RE.test(command)) return null;

  const policy = loadPolicy();
  const exceptions = loadExceptions();
  const audit =
    (await daemonAudit(command, policy, exceptions)) ??
    (await auditCommand(command, policy, exceptions));

  recordAudit({
    ts: new Date().toISOString(),
    event: 'check-command',
    command: audit.command,
    system: audit.system,
    decision:
      audit.effectiveVerdict !== 'SAFE' ? 'block' : audit.overrides.length > 0 ? 'override' : 'allow',
    verdict: audit.verdict,
    packages: audit.results.map(r => {
      const o = audit.overrides.find(x => x.name === r.name && x.version === r.version);
      const categories = [...new Set(r.violations.map(v => v.type))];
      return { name: r.name, version: r.version, verdict: r.verdict, categories, override: o?.reason, approvedBy: o?.approvedBy };
    }),
  });

  return audit;
}

/** Human/agent-readable block message, shared verbatim across adapters. */
export function formatBlockMessage(audit) {
  return (
    `🎾 Hawkeye blocked this install (supply-chain policy):\n\n${formatInstallPlan(audit)}\n\n` +
    `If a safe version is suggested above, retry the install with that exact ` +
    `version. Otherwise pick a safe alternative, or proceed only with an ` +
    `explicit, documented exception.`
  );
}
