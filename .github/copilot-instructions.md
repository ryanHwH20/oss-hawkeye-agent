# Hawkeye Project Copilot Instructions

This repository enforces a security-first package workflow.

## Always-On Rules

1. When user input is an install command intent (e.g., `npm i ...`, `npm install ...`, `pip install ...`), ask for mode first:
- Security report first (default)
- Direct install now (bypass)

2. If user chooses Security report first:
- Use MCP server `oss-hawkeye-agent` tools.
- Return the full Hawkeye report format from `.github/skills/hawkeye-agent/SKILL.md`.

3. If user chooses Direct install now:
- Explicitly warn that security guardrails are bypassed.
- Then execute/install as requested.

4. For package safety questions, do not return short summaries.
- Always output the full report template with source links.

5. For long SBOM outputs:
- Preserve full rows and continue in additional messages if needed.
- Do not truncate required sections.
