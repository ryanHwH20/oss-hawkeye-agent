# Roadmap

This roadmap turns the [Vision](VISION.md) into milestones. It complements the
high-level list in the [README](../README.md#-roadmap); issue numbers are the
source of truth.

## ✅ v1.1 — Trustworthy Core (shipped)

The foundation: make the verdict trustworthy.

- Fail-closed three-state verdict — `SAFE` / `BLOCKED` / `UNKNOWN` ([#7](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/7))
- Request timeouts + retries; distinct exit codes (`0` / `1` / `2`) ([#8](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/8))
- Bounded concurrency, OSV `querybatch`, in-flight de-duplication ([#9](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/9))
- Vitest suite (36 tests) incl. pure-logic coverage ([#10](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/10))

## 🔜 v1.2 — CI-Ready Integration

Make the output consumable by machines and policies.

- `--json` / `--sarif` output for GitHub Code Scanning ([#11](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/11))
- SPDX-expression-aware license matching ([#12](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/12))
- Configurable severity threshold in policy ([#13](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/13))

## 🚀 v1.3 — Meet Developers Where They Are (adoption engine)

Turn Hawkeye from a per-package curiosity into a CI/PR workflow. **This is the
biggest adoption unlock.**

- `hawkeye scan` — audit a whole project manifest ([#23](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/23))
- Official GitHub Action + PR comment bot ([#24](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/24))
- Frictionless distribution: `npx`, Docker image, pre-commit hook ([#25](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/25))

## 🔮 v2.0 — AI-Agent Guardrail (differentiation / moat)

Become the enforced gate inside the AI coding-agent loop, and add what the data
providers don't.

- MCP server: enforce a Hawkeye audit on AI-agent install/tool calls ([#26](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/26))
- AI-assisted automated remediation PRs ([#27](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/27))
- Malware / typosquat detection signal ([#28](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/28))
- Shared policy registry — `fintech-strict`, `startup-relaxed` ([#29](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/29))

## 🧱 Ongoing — Trust & Hygiene

A supply-chain tool must be a supply-chain exemplar.

- SLSA provenance + signed releases ([#30](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/30))
- Engineering hygiene sweep ([#14](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/14))
- Document the feature testing flow + PR checklist ([#21](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/21))

## How we measure success

The north star is **audits run via CI/Action per week**, supported by:

- **Reach:** GitHub stars → npm weekly downloads → Action installs
- **Retention:** 30-day re-use
- **Community:** external contributors, good-first-issue completion, issue response time
- **Trust:** our own OpenSSF Scorecard score; zero known vulnerabilities in our own dependencies
