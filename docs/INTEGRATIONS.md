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
instead, set `HAWKEYE_BIN` (e.g. `node .../dist/cli.js`) in the hook command.

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
