# Vision

**Hawkeye Agent is the supply-chain security guardrail for the way software gets built now — including by AI coding agents — that you can actually trust to fail safe.**

## The problem

Developers (and increasingly AI agents) add open-source dependencies constantly. The risk is real — vulnerabilities, restrictive licenses, unmaintained packages, and a fast-growing wave of malicious and typosquatted packages. The tooling that exists either lives far from where the decision is made (a dashboard, a nightly scan) or, worse, **fails open**: when a scanner can't reach its data sources, it quietly reports "no findings" and waves the package through.

For a security tool, failing open is the cardinal sin. The umpire didn't see the ball and called it *in*.

## What we believe

1. **Fail closed, always.** If we could not verify a package, we say so — `UNKNOWN` — and never present it as safe. This is our core, non-negotiable principle. ([#7](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/7))
2. **Meet developers where the decision happens** — in the PR, in CI, in the editor, and inside the AI agent's tool loop — not in a separate dashboard.
3. **One question, one integrated verdict.** License + CVE/CVSS + OpenSSF Scorecard + deep transitive SBOM + policy + remediation, in a single answer.
4. **Speak standard formats.** SARIF, CycloneDX, OSV — so we plug into the toolchains teams already run instead of inventing silos.
5. **Be a supply-chain exemplar.** A tool that judges others' security must itself be pristine: Scorecard, pinned actions, provenance, signed releases.

## Positioning — two wedges

We do **not** try to beat incumbents (Snyk, Socket, GitHub Advanced Security) head-on. We win on two fronts:

| Wedge | Goal | Why it works |
| :--- | :--- | :--- |
| **A — Adoption.** Whole-repo scan + PR/CI integration + standards | Get Hawkeye into thousands of pipelines | Frictionless, free, standards-compatible |
| **B — Differentiation.** The enforced gate inside the AI coding-agent loop | Build a defensible niche | Largely unoccupied as AI agents start writing and installing code |

Wedge A brings reach and community; Wedge B builds the moat.

## Honest boundaries

We orchestrate excellent open data ([deps.dev](https://deps.dev), [OSV.dev](https://osv.dev), OpenSSF Scorecard). Today that means our defensibility comes from **trustworthy behavior (fail-closed), ergonomics, and integration** — not proprietary data. The roadmap's job is to add what the data providers don't: **enforced AI-agent gating, malware/typosquat detection, and automated remediation.**

See [ROADMAP.md](ROADMAP.md) for how we get there.
