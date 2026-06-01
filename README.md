# 🎾 Hawkeye Agent

**The indisputable, high-precision line-judge for your software supply chain.**

[![NPM Version](https://img.shields.io/npm/v/hawkeye-agent?style=flat-square)](https://www.npmjs.com/package/hawkeye-agent)
[![License](https://img.shields.io/github/license/ryanHwH20/hawkeye-agent?style=flat-square)](https://github.com/ryanHwH20/hawkeye-agent/blob/main/LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/ryanHwH20/hawkeye-agent/hawkeye.yml?branch=main&style=flat-square)](https://github.com/ryanHwH20/hawkeye-agent/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

In professional tennis, the Hawk-Eye system provides millimeter-accurate, indisputable judgments on whether a ball is in or out. In the modern software supply chain, developers need an equally authoritative system to judge whether an open-source dependency is "safe to use" or "out of bounds."

**Hawkeye Agent** is an enterprise-grade Context-Aware Security Guardrail. It evaluates open-source packages in milliseconds, giving you a definitive, unquestionable verdict on license compliance, known vulnerabilities, OpenSSF health, and deep transitive dependencies (SBOM). 

When Hawkeye calls a package "OUT", it doesn't just block your build—it provides immediate AI-guided automated remediation snippets so you can keep moving.

---

## ✨ Features

- **🎾 Millimeter-Accurate Line Calling**: Blocks high-risk vulnerabilities and non-compliant licenses instantly, returning standard exit codes (0/1) for easy CI/CD integration.
- **🔍 Deep SBOM Transitive Scanning**: Analyzes deep dependency graphs via deps.dev to catch "shadow vulnerabilities" that standard manifest scanners miss.
- **💡 Automated Remediation**: If a package is blocked, Hawkeye suggests compliant alternatives or generates `overrides` code snippets for you to drop directly into your project.
- **🤖 MCP Protocol Native**: Seamlessly integrates into Cursor, VSCode, or any LLM agent IDE using the Model Context Protocol (MCP) to provide real-time architectural guardrails.

---

## 🚀 Installation & CLI Usage

Install Hawkeye Agent globally via NPM:

```bash
npm install -g hawkeye-agent
```

### 1. Single Package Audit
Run the `hawkeye` CLI tool to get a full enterprise-grade security report.

**Syntax:**
```bash
hawkeye <ecosystem> <package> <version>
```

**Examples:**
```bash
hawkeye NPM express 4.16.0
hawkeye MAVEN org.springframework.boot:spring-boot 3.5.8
hawkeye PYPI requests 2.31.0
```

### 2. CI/CD Integration
Because Hawkeye returns standard exit codes (`0` for pass, `1` for blocked), it fits perfectly into any GitHub Actions or GitLab CI pipeline.

Drop this into `.github/workflows/hawkeye.yml` to prevent non-compliant packages from entering your repository:

```yaml
name: Hawkeye Agent Audit
on: [pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install -g hawkeye-agent
      - run: |
          # Replace with your dynamic package list
          hawkeye NPM express 5.2.1
```

---

## 🤖 MCP (Model Context Protocol) Usage

Hawkeye Agent is built from the ground up to be an MCP server. By connecting it to an LLM, the LLM becomes context-aware of your organization's security posture and can prevent developers from introducing non-compliant packages *before* they are even typed into the editor.

**Available Tools:**
- `inspect_package`: Fetch a detailed compliance and security report for a single package.
- `check_command`: Parse raw commands (like `npm install lodash express`) and run batch security assessments.
- `show_policy`: View the active enterprise security baseline thresholds.

### Running the MCP Server
If you've installed it globally, you can configure your IDE (e.g. Cursor) to run:
```json
{
  "mcpServers": {
    "hawkeye": {
      "command": "node",
      "args": ["<path-to-global-node-modules>/hawkeye-agent/dist/server.js"]
    }
  }
}
```

---

## 🏛️ Enterprise Policy Configuration

Hawkeye uses a `.audit-agent.yaml` file in the current working directory to enforce compliance. 

```yaml
policy:
  organizationName: "Security Team"
  blockedLicenses:
    - "GPL-1.0-only"
    - "GPL-2.0-only"
    - "GPL-3.0-only"
  minScorecardScore: 4.0
  blockVulnerabilities: true
```

*Hawkeye Agent: Keeping your codebase strictly within the baseline.*
