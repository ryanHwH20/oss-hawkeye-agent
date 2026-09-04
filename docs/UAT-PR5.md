# PR5 Maintainer UAT — MCP adapter

PR5 is accepted when a maintainer can connect a real MCP client to the compiled
stdio server, discover exactly three Hawkeye tools, assess all seven supported
ecosystems, and resume the returned workflow state without any package-manager
command being executed.

The optional MCP adapter requires Node.js 20 or newer. The main Hawkeye CLI and
library retain their Node.js 18 support.

## 1. Run the automated seven-ecosystem UAT

```bash
npm run uat:pr5
```

This builds Hawkeye and the production MCP bundle, launches
`hawkeye-mcp` over stdio, and connects with the official MCP TypeScript client.
It performs live evidence queries for NPM, PyPI, Cargo, Go, RubyGems, NuGet,
and Maven, but never runs the assessed install commands.

Confirm:

- the server exposes exactly `hawkeye_check_action`,
  `hawkeye_next_action`, and `hawkeye_submit_result`;
- every row contains the expected ecosystem coordinate;
- `structured` and `deterministic` are `yes` for all seven rows;
- the final summary is `UAT PASSED`.

Verdicts can change when upstream evidence changes. `SAFE`, `BLOCKED`, and
`UNKNOWN` are all valid UAT observations; the contract, coordinate, state
replay, and fail-closed behavior are the acceptance criteria.

## 2. Connect from Codex

From this repository, register the local stdio server:

```bash
codex mcp add oss-hawkeye -- node "$(pwd)/adapters/mcp/launcher.mjs"
codex mcp list
```

Restart or open a new Codex conversation, then ask:

```text
Use Hawkeye to check `npm install is-number@7.0.0`. Do not run the install.
Tell me the verdict, policy digest, and next action.
```

Confirm Codex uses `hawkeye_check_action` and reports that no package-manager
command was executed. Then ask it to inspect the next action again; confirm it
uses `hawkeye_next_action` with the returned state and produces the same action.

Codex discovers this as an MCP tool, not an `@` participant. A `$oss-hawkeye`
or slash-style shortcut requires a separate platform Skill and is outside PR5.

## 3. Connect from Claude Code

Register the same local server at project scope:

```bash
claude mcp add --transport stdio --scope project oss-hawkeye -- node "$(pwd)/adapters/mcp/launcher.mjs"
claude mcp list
```

Start a new Claude Code conversation and use the same prompt from the Codex
step. Confirm Claude discovers the three Hawkeye tools, invokes
`hawkeye_check_action`, and does not run the install command.

Claude Code exposes MCP tools through its own tool UI. A `/oss-hawkeye`
shortcut requires a separate Claude Skill and is outside PR5.

## 4. Fail-closed checks

Ask the client to check an unrelated command:

```text
Use Hawkeye to check `echo hello`. Do not execute it.
```

Confirm it returns `NOT_APPLICABLE`, not `SAFE`.

If your MCP inspector supports raw tool calls, add an unexpected input field or
alter `state.intent.cwd` before calling `hawkeye_next_action`. The request must
return a tool error and must not issue approval.

## 5. Enforcement boundary

MCP is a model-controlled advisory surface. It does not intercept Bash and does
not replace the Claude Code `PreToolUse` hook or a package-manager shell shim.
Throughout this UAT, verify that npm, pip, Cargo, Go, gem, dotnet, and Maven are
not launched.

## 6. Regression gates

```bash
npm run build
npm test
npm run build:mcp
npm pack --dry-run
git diff --check
```

## Rollback

```bash
codex mcp remove oss-hawkeye
claude mcp remove --scope project oss-hawkeye
```

Removing the MCP registration does not remove or weaken separately configured
hooks or shell shims.

## UAT sign-off record

```text
UAT owner:
Date / timezone:
Commit SHA:
Node / npm versions:
Automated seven-ecosystem UAT: PASS / FAIL
Codex tool discovery: PASS / FAIL / NOT RUN
Claude Code tool discovery: PASS / FAIL / NOT RUN
Exactly three tools exposed: YES / NO
State replay deterministic: YES / NO
NOT_APPLICABLE remains distinct from SAFE: YES / NO
No package-manager command executed: YES / NO
Notes or screenshots:
```
