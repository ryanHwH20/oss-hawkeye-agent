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

## Claude Code (PreToolUse hook) — recommended

A [PreToolUse hook](https://docs.claude.com/en/docs/claude-code/hooks) runs
before every Bash command. The shipped hook ([`hooks/claude-code-precheck.mjs`](../hooks/claude-code-precheck.mjs))
inspects the command, audits any install, and **blocks** it on a BLOCKED /
UNVERIFIED verdict — a true gate, not a prompt suggestion.

Add to `~/.claude/settings.json` (global — applies to every project):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node /absolute/path/to/oss-hawkeye-agent/hooks/claude-code-precheck.mjs" }
        ]
      }
    ]
  }
}
```

The hook calls the `hawkeye` CLI on your `PATH`. To point it at a local build
instead, set `HAWKEYE_BIN` — it may include arguments, so a dev build works:

```json
{ "type": "command",
  "command": "node /abs/path/to/oss-hawkeye-agent/hooks/claude-code-precheck.mjs",
  "env": { "HAWKEYE_BIN": "node /abs/path/to/oss-hawkeye-agent/dist/cli.js" } }
```

`HAWKEYE_BIN` is split on whitespace, so the executable's own path must not
contain spaces.

**Fail-closed by design.** If the hook detects an install but Hawkeye can't
verify it — the CLI isn't installed, `HAWKEYE_BIN` is wrong, or it crashes —
the install is **blocked** (exit 2), not waved through. A gate that fails open
is no gate. Non-install commands (`npm ci`, `go build`, …) are always allowed.

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
