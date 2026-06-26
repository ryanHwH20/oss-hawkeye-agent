# Strategy & Engineering Arc

This document is the handoff narrative for the work that took Hawkeye from a
"trustworthy core" CLI to an **enforced, measured, hardened supply-chain
guardrail for the AI-agent era**. It complements the two standing documents:

- **[VISION.md](VISION.md)** — positioning and non-negotiable beliefs.
- **[ROADMAP.md](ROADMAP.md)** — the issue-linked plan.

Here we record *why the work was sequenced the way it was, what each piece
solved, and what it measurably achieved* — plus the honest boundaries and the
strategic decisions that remain.

---

## The thesis (sharpened)

We do not win by being another SCA scanner — license/CVE/Scorecard scanning is a
crowded field with no proprietary-data moat for us. We win on one wedge:

> **The first fail-closed, enforced gate inside the AI coding agent's tool loop —
> that is also invisible enough to keep, honest enough to trust, and governed
> enough to adopt.**

Everything below serves that sentence. A scanner that an engineer disables, an
agent routes around, or a security team can't measure is worth nothing.

---

## The arc, in three questions

The work answered three questions in order. Each is a gate the product had to
clear before the next mattered.

### 1. Is it a *gate*, and will engineers keep it? (adoption & ergonomics)

| Shipped | What it solved |
| :-- | :-- |
| **Install guardrail (#46)** | `check-command` + a Claude Code PreToolUse hook — a *real* block before install, not a prompt. The wedge. |
| **Cross-process cache (#50)** | The hook spawns a fresh process per install → the in-memory cache was always cold. Persisted immutable deps.dev metadata: repeat audit **3.1s → 0.6s**. |
| **Agent self-correction (#51)** | A block the agent can *act on*: structured `remediation` names the exact safe `name@version`, and the recommendation is **re-audited before it's offered** so the agent never loops on a "fix" that's itself blocked. |
| **Governed exceptions + telemetry (#52)** | The legitimate escape hatch: a repo-local, expiring, audited `.hawkeye-exceptions.yaml` (a human artifact an agent can't self-grant) instead of ripping the hook out — plus `HAWKEYE_AUDIT_LOG`. |
| **GitHub Action + PR bot (#54)** | Meets the decision in the PR: scan, upload SARIF, sticky comment. The adoption surface (Wedge A). |

### 2. Is it *right*? (correctness & precision)

The brand is "indisputable, high-precision." That has to be measured and
hardened, not asserted.

| Shipped | What it solved |
| :-- | :-- |
| **Typosquat detection (#28 / #53)** | A name-based signal the data sources don't provide (`expres`→`express`), blocking; false positives recoverable via exception. |
| **Evaluation harness (#56)** | We had never *measured* precision. A labeled corpus + CI gate: **100% precision, 100% recall on catchable squats, 88% overall** — and the combosquat ceiling is tracked as visible `hard` cases, not hidden. |
| **Lockfile-aware scan (#57)** | We audited the *declared* range floor (`^4.17.1`→`4.17.1`), not what npm installs (`4.21.2`). Now we prefer the lockfile and audit the **resolved** version. |
| **OSV malware signal (#58)** | Known-malicious packages (`MAL-*`) often carry no CVSS, so the severity threshold let them through. Now a dedicated `MALWARE` finding **blocks unconditionally**. A data-backed signal, not a heuristic. |

### 3. Is it *trustworthy and measurable* at scale? (integrity & governance)

| Shipped | What it solved |
| :-- | :-- |
| **Cache integrity (#55)** | The cross-process cache we added (#50) was unauthenticated in shared `/tmp` — a local `postinstall` could forge an entry to downgrade a verdict. Now HMAC-authenticated, URL-bound, in a private `0700` dir. A supply-chain tool must not trust its own cache. |
| **`audit-report` (#59)** | Raw JSONL → org metrics: block rate, override rate, most-blocked, breakdown by category. Makes the gate's value measurable — the first step toward fleet-wide insight. |
| **Resident daemon (#60)** | The performance endpoint: warm caches + a recent-verdict memo take a repeated install **~0.9s → ~0.05s** — under the "invisible" bar. Optional; falls back in-process. |

---

## Measured outcomes

- **Foundation + 11 follow-on PRs** merged green (#46, #50–#60); **62 → 141 tests**.
- **Install-gate latency:** 3.1s cold → 0.6s warm (disk cache) → **~0.05s** repeat (daemon memo).
- **Typosquat precision:** **100%** (zero false positives) with a CI regression gate.
- **Fail-closed integrity:** verdicts no longer bypassable via UNKNOWN-severity malware, a poisoned cache, a declared-vs-installed gap, or a non-existent (typosquat-shaped) name.
- A real bug (SARIF code-scanning rejection) was caught by **dogfooding** the Action on our own PRs before it reached a single user.

---

## Honest boundaries (what is deliberately not solved)

- **No proprietary-data moat yet.** We orchestrate deps.dev / OSV / Scorecard. Defensibility today is *behavior* (fail-closed), *ergonomics* (invisible), *integration* (agent loop), and *governance* — not data.
- **Typosquat is distance-1 + separator + popularity-by-curated-list.** Combosquats and multi-edit names are the measured ceiling. Real coverage needs live popularity data and behavioral signals.
- **Coverage is npm-deep, others shallow.** Lockfile resolution is npm-only; yarn/pnpm/poetry and most ecosystems' manifests beyond `package.json` / `requirements.txt` are not yet parsed. Bare `npm install` / `npm ci` (bulk restore) is gated by CI scan + the Action, not the per-install hook (by design — latency).
- **Telemetry is local.** `audit-report` aggregates files; there is no hosted, cross-org sink or learning loop.

---

## What remains — strategic, not mechanical

These are product/architecture decisions, not the next ticket:

1. **The real moat — a cross-org learning loop.** Turn aggregated block / override / typosquat / malware signals into detection that incumbents can't replicate from public data alone. Needs a hosted backend and a privacy model. This is the defensible bet.
2. **Typosquat beyond the ceiling.** Feed the evaluation harness with real malicious-package corpora; add live download-popularity and install-script/behavioral signals to lift recall past combosquats.
3. **Breadth of coverage.** yarn/pnpm/poetry lockfiles, more ecosystems, and resolved-tree auditing — closing the remaining "audited vs installed" surface.

The first two pieces (precision measured, telemetry aggregated) are now in place,
which is exactly what makes #1 and #2 above tractable: we can finally *measure*
whether a detection change is an improvement, and we have the raw signal to learn
from. That was the point of doing them first.
