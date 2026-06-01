# 🎾 Hawkeye Agent

**The indisputable, high-precision line-judge for your software supply chain.**

[![NPM Version](https://img.shields.io/npm/v/oss-hawkeye-agent?style=flat-square)](https://www.npmjs.com/package/oss-hawkeye-agent)
[![License](https://img.shields.io/github/license/ryanHwH20/oss-hawkeye-agent?style=flat-square)](https://github.com/ryanHwH20/oss-hawkeye-agent/blob/main/LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/ryanHwH20/oss-hawkeye-agent/hawkeye.yml?branch=main&style=flat-square)](https://github.com/ryanHwH20/oss-hawkeye-agent/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

In professional tennis, the Hawk-Eye system provides millimeter-accurate, indisputable judgments on whether a ball is in or out. In the modern software supply chain, developers need an equally authoritative system to judge whether an open-source dependency is "safe to use" or "out of bounds."

**Hawkeye Agent** is an enterprise-grade, AI-native security guardrail that evaluates open-source packages in milliseconds. It gives you a definitive verdict on license compliance, known vulnerabilities (CVE/CVSS), OpenSSF Scorecard health, and deep transitive dependencies (SBOM).

When Hawkeye calls a package **"OUT"**, it doesn't just block — it provides immediate, AI-guided automated remediation so you can keep moving.

---

## ✨ Features

- 🎾 **Millimeter-Accurate Line Calling** — Blocks high-risk vulnerabilities and non-compliant licenses instantly, returning standard exit codes (`0`/`1`) for CI/CD integration.
- 🔍 **Deep SBOM Transitive Scanning** — Analyzes full dependency graphs via [deps.dev](https://deps.dev) to catch "shadow vulnerabilities" that standard manifest scanners miss.
- 💡 **AI-Powered Remediation** — When a package is blocked, Hawkeye generates upgrade snippets, `overrides` blocks, or delegates to your AI assistant to recommend compliant alternatives dynamically.
- 🤖 **MCP Protocol Native** — Seamlessly integrates into Cursor, VS Code, or any LLM agent IDE via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), providing real-time architectural guardrails *inside* your conversation.
- 🌐 **7 Ecosystems** — NPM, PyPI, Cargo, Go, RubyGems, NuGet, Maven — all from a single tool.
- 🏛️ **Policy-as-Code** — Drop a `.audit-agent.yaml` into your repo to enforce organization-specific compliance rules.

---

## 🚀 Quick Start

### Installation

```bash
npm install -g oss-hawkeye-agent
```

### Single Package Audit

```bash
hawkeye NPM express 4.16.0
hawkeye PYPI requests 2.31.0
hawkeye MAVEN org.springframework.boot:spring-boot 3.5.8
```

### Example Output

```
# Package Audit: express@4.16.0 (NPM)

> ### ❌ BLOCKED — Security Policy Violation

## Quick Reference
| Category         | Status                          |
| :---             | :---                            |
| 📜 License       | ✅ MIT — Compliant              |
| 🐛 Vulnerabilities | ❌ 2 Vulns (1 High)           |
| 📊 OpenSSF Scorecard | 🟢 7.5/10                  |

## 🚀 Automated Remediation
> 💡 Official patches are available. Upgrade to `4.21.2`:
npm install express@4.21.2
```

---

## 🤖 MCP (Model Context Protocol) Integration

Hawkeye Agent is built from the ground up as an **MCP server**. By connecting it to an LLM, the AI becomes context-aware of your organization's security posture and can prevent developers from introducing non-compliant packages *before* they are even installed.

### Available MCP Tools

| Tool | Description |
| :--- | :--- |
| `inspect_package` ⭐ | Enterprise-grade deep evaluation of a single package |
| `check_command` | Parse installation commands (`npm install lodash express`) and run batch assessments |
| `show_policy` | View the active enterprise security baseline |

### Setup

Add this to your IDE's MCP configuration (e.g., `.vscode/mcp.json`):

```json
{
  "servers": {
    "oss-hawkeye-agent": {
      "command": "node",
      "args": ["<path-to>/oss-hawkeye-agent/dist/server.js"]
    }
  }
}
```

Once connected, your AI assistant will automatically audit packages when you:
- Ask "Is lodash safe?"
- Paste `npm install express`
- Ask "Can we use GPL packages?"

---

## ⚙️ CI/CD Integration

Hawkeye returns standard exit codes (`0` = pass, `1` = blocked), making it a drop-in security gate for any pipeline.

### GitHub Actions

```yaml
name: Hawkeye Agent Audit
on: [pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install -g oss-hawkeye-agent
      - run: hawkeye NPM express 5.2.1
```

---

## 🏛️ Policy Configuration

Hawkeye uses a `.audit-agent.yaml` file in the working directory to enforce compliance. If none is found, it falls back to the built-in `policy.json`.

```yaml
policy:
  organizationName: "Your Organization"
  blockedLicenses:
    - "GPL-2.0-only"
    - "GPL-3.0-only"
    - "AGPL-3.0-only"
    - "SSPL-1.0"
    - "BUSL-1.1"
  minScorecardScore: 4.0
  blockVulnerabilities: true
  blockDeprecated: true
  exceptionFormUrl: "https://your-org.com/oss-exception-request"
```

---

## 🗺️ Roadmap

We're building Hawkeye Agent into the definitive shift-left security tool for developers. Here's where we're headed:

### ✅ Shipped (v1.0)

- [x] Single package audit across 7 ecosystems (NPM, PyPI, Go, Cargo, Maven, NuGet, RubyGems)
- [x] Batch command parsing (`npm install lodash express`)
- [x] License compliance checking with configurable blocklists
- [x] CVE vulnerability scanning via [OSV.dev](https://osv.dev)
- [x] OpenSSF Scorecard integration with severity-weighted analysis
- [x] Deep SBOM transitive dependency scanning
- [x] MCP server with 3 tools (`inspect_package`, `check_command`, `show_policy`)
- [x] AI Skill Prompt (`SKILL.md`) with loop prevention and dynamic alternative recommendations
- [x] Automated remediation snippets (upgrade paths, overrides, AI-guided alternatives)
- [x] CLI with standard exit codes for CI/CD
- [x] Policy-as-Code via `.audit-agent.yaml`

### 🔜 Next Up

- [ ] **Publish to NPM** — Enable `npx oss-hawkeye-agent` for instant use
- [ ] **`--json` and `--sarif` output** — Machine-readable formats for toolchain integration
- [ ] **Caching layer** — In-memory + disk cache with TTL to avoid redundant API calls
- [ ] **Comprehensive test suite** — Vitest + mocked API responses for contributor confidence

### 🔮 Future

- [ ] **`hawkeye scan` command** — Auto-detect and audit entire project manifests (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`)
- [ ] **Official GitHub Action** — `uses: ryanHwH20/hawkeye-action@v1` with PR comment bot
- [ ] **VS Code Extension** — Inline diagnostics and hover tooltips for risky dependencies
- [ ] **HTML report export** — Beautiful, shareable security reports (like Lighthouse)
- [ ] **Plugin system** — Custom policy rules (e.g., "block packages with <100 weekly downloads")
- [ ] **Shared policy registry** — Community-maintained templates (`fintech-strict`, `startup-relaxed`)

> 💡 **Have an idea?** [Open an issue](https://github.com/ryanHwH20/oss-hawkeye-agent/issues) or submit a PR — contributions are welcome!

---

## 🏆 Why Hawkeye?

| Capability | Hawkeye | Snyk | Socket | npm audit | OSV-Scanner |
| :--- | :---: | :---: | :---: | :---: | :---: |
| License Scanning | ✅ | ✅ | ✅ | ❌ | ❌ |
| Vulnerability Scanning | ✅ | ✅ | ✅ | ✅ | ✅ |
| SBOM Analysis | ✅ | ✅ | ✅ | ❌ | ❌ |
| OpenSSF Scorecard | ✅ | ❌ | ❌ | ❌ | ❌ |
| AI-Native (MCP) | ✅ ⭐ | ❌ | ❌ | ❌ | ❌ |
| Policy-as-Code | ✅ | ✅ | ✅ | ❌ | ❌ |
| Free & Open Source | ✅ | Freemium | Freemium | ✅ | ✅ |

> **Hawkeye's unique advantage:** It's the only open-source security tool that is **MCP-native**, giving LLMs real-time, structured security context about every package a developer touches — right inside the IDE conversation.

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

[Apache-2.0](LICENSE)

---

*Hawkeye Agent: The indisputable, high-precision line-judge for your software supply chain.* 🎾
