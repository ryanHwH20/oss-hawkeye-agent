# Integrations — gating AI-agent installs

Hawkeye can audit a package *before* it is installed. The `check-command`
subcommand is the primitive; the integrations below turn it into an enforced
guardrail so an AI coding agent (or a human) can't add a dependency that
violates policy.

```bash
# Audit what an install command would add — exit 0 pass / 1 blocked / 2 error
hawkeye check-command "npm install lodash express"
hawkeye check-command "pip install requests==2.31.0"
```

## Agent self-correction

On a block, `check-command` returns a structured `remediation[]` (visible in
`--json` and surfaced in the deny reason) so an agent can fix-and-retry instead
of stopping:

```jsonc
// hawkeye check-command "npm install lodash@4.17.11" --json  →  .remediation[0]
{
  "name": "lodash", "current": "4.17.11",
  "action": "upgrade",            // upgrade | find-alternative | verify
  "recommendedVersion": "4.18.0",
  "fix": "lodash@4.18.0",         // ready-to-install spec
  "verified": true,               // the recommendation was itself re-audited and passed
  "reason": "…4.18.0 is patched. Re-run the install with lodash@4.18.0. (verified clean)"
}
```

An `upgrade` is only ever offered after the recommended version is **re-audited
and passes**, so the agent is never sent to a "fix" that is itself blocked. When
no clean version exists (e.g. a vulnerable transitive dependency), the action
degrades to `find-alternative` with an honest reason.

## PR change note

Once the agent has applied the fix and opens a PR that bumps the version, a
reviewer still needs the *why*. `pr-note` generates a paste-ready Markdown block
from the same re-verified audit — risk summary, the version change with its
semver impact, a compatibility caveat, and a testing checklist:

```bash
hawkeye pr-note "npm install axios@1.7.2 lodash@4.17.21" >> "$PR_BODY"
```

```markdown
### Risk summary
- `axios@1.7.2` — Known Vulnerability at or above MEDIUM severity

### Applied fix
| Package | From | To | Impact |
| :-- | :-- | :-- | :-- |
| `axios` | `1.7.2` | `1.16.0` | Minor bump — backward-compatible under semver. |

### Testing
- [ ] Run the full test suite
- [ ] Smoke-test the paths that use `axios`
```

Major bumps are flagged as breaking with an extra review checkbox; packages with
no safe upgrade are split into a "Still needs manual attention" list; and
exception-approved packages are omitted (there's no change to justify). It's a
document generator, not a gate — it always exits 0 so it composes into a PR-body
pipeline. `--json` emits the underlying audit.

## Documented exceptions (the governed escape hatch)

When a block is a known, accepted risk, don't rip the guardrail out — record an
exception. Drop a `.hawkeye-exceptions.yaml` in the repo:

```yaml
exceptions:
  - package: express
    ecosystem: NPM          # optional — restrict to one ecosystem
    version: "4.16.0"       # optional — omit to accept any version (broader)
    reason: "Legacy billing service; migration tracked in JIRA-1234"  # required
    approvedBy: security-team
    expires: "2026-12-31T23:59:59Z"   # optional — after this it is inert
```

A matching, non-expired exception turns that package's block into an **allowed
override**: the install proceeds (exit 0) and is recorded as such. It **fails
closed**: an expired or malformed exception never applies.

**Provenance — an agent can't grant itself one.** An exception only takes effect
when `.hawkeye-exceptions.yaml` is **committed to git and unmodified** in the
working tree, so granting one leaves a reviewable commit. An uncommitted file —
e.g. one a gated agent just wrote to whitelist itself — is **ignored** (with a
warning). Outside a git repo (or with `HAWKEYE_TRUST_UNCOMMITTED_EXCEPTIONS=1`)
provenance can't be verified, so the file is honored. (A same-machine attacker
who can also forge commits is out of scope — but the abuse is then in git
history.)

## Audit log / telemetry

Set `HAWKEYE_AUDIT_LOG=/path/to/audit.jsonl` to append one JSON record per
`check-command` decision:

```json
{"ts":"…","event":"check-command","command":"npm install express@4.16.0","system":"NPM","decision":"override","verdict":"BLOCKED","packages":[{"name":"express","version":"4.16.0","verdict":"BLOCKED","override":"Legacy billing service…","approvedBy":"security-team"}]}
```

`decision` is `allow` | `block` | `override`. Point it at a central path to
measure block rate, override rate, and fix conversion across the org.

## AI-agent adapters (`adapters/`)

Every supported AI coding tool has one file under [`adapters/`](../adapters):
a thin translation layer over the shared audit core in
[`adapters/lib/gate.mjs`](../adapters/lib/gate.mjs). The core decides
SAFE/BLOCKED/UNKNOWN once; each adapter only translates its host tool's wire
format to/from that decision, so every tool sees the identical verdict and
message. Adapters import the audit logic directly from this package's own
`dist/` — no subprocess, no `HAWKEYE_BIN` — so an adapter and the audit logic
it calls can never drift out of version sync.

### VS Code Chat — `@oss-hawkeye`

The extension under [`adapters/vscode/`](../adapters/vscode) registers the exact
`@oss-hawkeye` participant and `/check`, `/scan`, `/explain`, `/fix`, `/policy`,
and `/status` commands.

```bash
npm run package:vscode
code --install-extension adapters/vscode/oss-hawkeye-vscode-0.1.0.vsix
```

```text
@oss-hawkeye /check npm install axios@1.7.2
@oss-hawkeye /status
```

The extension bundles the same Action Runtime, Decision Kernel, and Harness as
the package. It contains no provider calls or verdict logic of its own. The
latest `HawkeyeRunState` is stored in VS Code workspace state so status,
explanation, and verified remediation survive reloads without depending on chat
history.

This is an interactive advisory surface, not an install interceptor. It never
runs the displayed command, and uninstalling it does not change separately
configured PreToolUse hooks or shell shims. Full installation and rollback
steps are in [`docs/UAT-PR4.md`](UAT-PR4.md).

### MCP — Codex, Claude Code, and other clients

The optional local stdio server exposes the same canonical Runtime and Harness
through three tools:

- `hawkeye_check_action` assesses an exact proposed command;
- `hawkeye_next_action` validates carried state and returns the deterministic
  next action;
- `hawkeye_submit_result` records an external result for the exact pending
  action.

```bash
npm run build:mcp
```

The MCP adapter requires Node.js 20 or newer; the main CLI remains compatible
with Node.js 18. The server is pinned to its startup workspace, accepts bounded
strict-schema payloads, carries no hidden conversation state, and never runs a
package manager. Project-scoped MCP configuration is committed for Codex in
`.codex/config.toml` and Claude Code in `.mcp.json`; users still control project
trust and MCP approval in their host.

### Native cross-agent Skill

One provider-neutral Skill in [`skills/oss-hawkeye/`](../skills/oss-hawkeye)
drives the MCP workflow. Run `npm run sync:skills` after editing it; CI ensures
the Codex, Claude Code, and Copilot discovery copies remain byte-identical.

Use the host's native syntax:

```text
$oss-hawkeye check `pip install idna==3.7`       # Codex
/oss-hawkeye check `cargo add itoa@1.0.11`      # Claude Code
@oss-hawkeye /check npm install is-number@7.0.0 # VS Code Copilot
```

The Skill cannot approve itself or turn `UNKNOWN` or `NOT_APPLICABLE` into
`SAFE`. If the MCP adapter is unavailable, it reports the request as
unverifiable instead of offering a direct-install bypass.

See [`docs/UAT-PR6.md`](UAT-PR6.md) for automated seven-ecosystem verification,
native invocation checks in all three hosts, failure behavior, and rollback.

### Claude Code (PreToolUse hook) — recommended

A [PreToolUse hook](https://docs.claude.com/en/docs/claude-code/hooks) runs
before every Bash command. The shipped adapter
([`adapters/claude-code.mjs`](../adapters/claude-code.mjs)) inspects the
command, audits any install, and **blocks** it on a BLOCKED / UNKNOWN verdict
— a true gate, not a prompt suggestion.

Add to `~/.claude/settings.json` (global — applies to every project):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node /absolute/path/to/oss-hawkeye-agent/adapters/claude-code.mjs" }
        ]
      }
    ]
  }
}
```

**Fail-closed by design.** If the adapter detects an install but Hawkeye
can't verify it — a crash while auditing, a bad policy file — the install is
**blocked** (exit 2), not waved through. A gate that fails open is no gate.
Non-install commands (`npm ci`, `go build`, …) are always allowed.

## Any agent / any tool (shell shim)

For tool-agnostic enforcement (any AI, any editor, even humans), wrap the
package manager on your `PATH`:

```bash
# ~/bin/npm  (must precede the real npm on PATH)
#!/usr/bin/env bash
hawkeye check-command "npm $*" || { echo "Blocked by Hawkeye"; exit 1; }
exec /opt/homebrew/bin/npm "$@"
```

## Why not only MCP?

An MCP server gives an agent a *tool it can choose to call* — useful for rich,
interactive auditing, but it does not stop the agent from running `npm install`
directly. The hook/shim approach intercepts the install itself, so it holds
regardless of whether the agent cooperates. MCP is a complement, not a
replacement.
