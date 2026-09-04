# OSS Hawkeye MCP adapter

Local stdio MCP access to Hawkeye's canonical Action Runtime and Harness.

The server exposes `hawkeye_check_action`, `hawkeye_next_action`, and
`hawkeye_submit_result`. It never executes package-manager commands and is not
an enforcement replacement. Node.js 20 or newer is required for this optional
adapter; the main Hawkeye CLI remains compatible with Node.js 18.

Build from the repository root:

```bash
npm run build:mcp
node adapters/mcp/launcher.mjs
```

See `docs/UAT-PR5.md` for Codex, Claude Code, protocol UAT, and rollback.
