# PR6 Maintainer UAT — native cross-agent Skill

PR6 is accepted when maintainers can invoke the same Hawkeye workflow as
`$oss-hawkeye` in Codex, `/oss-hawkeye` in Claude Code, and `@oss-hawkeye` in
VS Code Copilot. The committed configuration must connect the Skill to the PR5
MCP adapter, preserve fail-closed decisions, and assess all seven ecosystems
without executing a package manager.

The local MCP adapter requires Node.js 20 or newer.

## 1. Run the automated seven-ecosystem UAT

```bash
npm run uat:pr6
```

This builds Hawkeye and the production MCP bundle, verifies that all platform
Skill copies match `skills/oss-hawkeye/SKILL.md`, reads the committed project
MCP configuration, and connects with the official MCP TypeScript client. It
queries live evidence for NPM, PyPI, Cargo, Go, RubyGems, NuGet, and Maven, but
does not run any install command.

Confirm every row has the expected coordinate, `skill` is `synced`,
`deterministic` is `yes`, and the final result is `UAT PASSED`. Upstream evidence
may make a verdict `SAFE`, `BLOCKED`, or `UNKNOWN`; those are all valid UAT
observations.

## 2. Test Codex — `$oss-hawkeye`

Open this repository as a trusted project and start a fresh Codex conversation.
The project contains both `.agents/skills/oss-hawkeye/SKILL.md` and
`.codex/config.toml`.

Enter `$` and confirm `oss-hawkeye` appears, then send:

```text
$oss-hawkeye check `pip install idna==3.7`. Do not install it.
```

Confirm Codex calls `hawkeye_check_action`, reports the returned verdict and
next action, and says no package-manager command was executed. If project MCP
configuration is not active yet, restart Codex after trusting the repository.

## 3. Test Claude Code — `/oss-hawkeye`

Open this repository in Claude Code. Approve the project-scoped `.mcp.json`
server when Claude asks; a repository cannot approve its own MCP server.

Enter `/oss-hawkeye` and confirm the Skill is discovered, then send:

```text
/oss-hawkeye check `cargo add itoa@1.0.11`. Do not install it.
```

Use `/mcp` to confirm `oss-hawkeye` is connected and exposes exactly
`hawkeye_check_action`, `hawkeye_next_action`, and `hawkeye_submit_result`.
Confirm the assessment does not run Cargo.

## 4. Test VS Code Copilot — `@oss-hawkeye`

Build and install the extension if it is not already present:

```bash
npm run package:vscode
code --install-extension adapters/vscode/oss-hawkeye-vscode-0.1.0.vsix
```

Reload VS Code and send:

```text
@oss-hawkeye /check dotnet add package Newtonsoft.Json --version 13.0.3
```

Confirm the existing participant still returns the canonical Hawkeye decision
and does not execute dotnet. Copilot uses its chat participant UI; it does not
need to render the `$` or `/` Skill syntax used by the other hosts.

## 5. Fail-closed checks

In Codex or Claude Code, ask the Skill to check `echo hello`. It must return
`NOT_APPLICABLE`, never `SAFE`. Then temporarily disable the `oss-hawkeye` MCP
server in the host UI and repeat a package request. The Skill must say the action
is unverifiable and must not approve or execute it.

Also confirm the conversation never offers “Direct install now” or “skip audit.”
A governed, committed Hawkeye exception remains the only supported override.

## 6. Regression gates

```bash
npm run check:skills
npm run build
npm test
npm run check:setup
npm pack --dry-run
git diff --check
```

## Rollback

Disable the `oss-hawkeye` MCP server in the relevant host. This removes the
interactive Skill's tool connection but does not remove or weaken separately
configured Claude `PreToolUse` hooks or package-manager shell shims.

## UAT sign-off record

```text
UAT owner:
Date / timezone:
Commit SHA:
Node / npm versions:
Automated seven-ecosystem UAT: PASS / FAIL
Codex $oss-hawkeye discovery: PASS / FAIL / NOT RUN
Claude /oss-hawkeye discovery: PASS / FAIL / NOT RUN
Copilot @oss-hawkeye regression: PASS / FAIL / NOT RUN
Exactly three MCP tools exposed: YES / NO
State replay deterministic: YES / NO
NOT_APPLICABLE remains distinct from SAFE: YES / NO
Missing MCP fails closed: YES / NO
No package-manager command executed: YES / NO
Notes or screenshots:
```
