# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Audit the installed version, not the declared range (lockfile-aware scan).**
  `hawkeye scan` now prefers `package-lock.json` / `npm-shrinkwrap.json` over
  `package.json` when present, auditing each direct dependency at the version npm
  will actually install (e.g. `^4.17.1` → the resolved `4.21.2`) instead of the
  range floor. Closes the "audited declared, not installed" gap for npm; the
  manifest is still used when no lockfile exists.
- **Typosquat detection evaluation harness.** The product's core claim is
  precision, so it is now measured, not asserted. A labeled corpus
  (`test/fixtures/typosquat-eval.json`) drives a CI-gating test
  (`npm run eval:typosquat`) that computes precision / recall / F1 and fails the
  build on regression. Current seed corpus: **100% precision (zero false
  positives), 100% recall on catchable (distance-1 / separator) squats, 88%
  overall** — the gap is the known combosquat/multi-edit ceiling, tracked
  explicitly as `hard` cases so the limitation is visible rather than hidden.

### Security
- **Authenticated, private on-disk cache.** The cross-process cache fed verdict
  inputs (licenses, dependency graph) but was unauthenticated — a local process
  (e.g. a malicious `postinstall`) could forge an entry to downgrade a BLOCKED
  package to SAFE. Entries are now HMAC-authenticated with a per-cache `0600`
  key and bound to their URL (a tampered/forged/cross-URL entry is rejected as a
  miss), and the cache moved from shared `/tmp` to a private `0700` directory
  (`$XDG_CACHE_HOME/hawkeye` or `~/.cache/hawkeye`) with `0600` files. This
  defeats cross-user and blind forgery; same-user code execution remains out of
  scope (it can disable the guardrail outright).

### Added
- **Official GitHub Action + PR comment bot (#24).** A composite action
  ([`action.yml`](action.yml)) scans a project on every pull request, uploads
  SARIF to GitHub code scanning, and posts a **sticky PR comment** (updated in
  place via a hidden marker, not stacked) with the verdict — failing closed by
  default. The comment is rendered by a new `hawkeye scan . --comment` mode, so
  the same Markdown is reproducible locally. The action builds from its own
  pinned source and posts via the preinstalled `gh` CLI (no new third-party
  action dependency); the repo dogfoods it in `.github/workflows/hawkeye-pr-scan.yml`.
- **Typosquat / malicious-package detection (#28).** A package whose name is a
  one-edit look-alike (or a separator/case variant) of a popular package — e.g.
  `expres` for `express`, `requets` for `requests`, `lo-dash` for `lodash` — is
  now flagged and **blocked** as a likely typosquat, the shape of a real
  supply-chain malware attack. This is a signal the upstream data sources don't
  provide. Detection is name-based (no network), checked against a curated
  per-ecosystem list that also exempts legitimate near-neighbours (`preact` next
  to `react`), and a package that is itself popular is never flagged. False
  positives are recoverable via a documented exception; disable with
  `blockTyposquats: false` in policy.
- **Audited exceptions + telemetry — the governed escape hatch.** A
  `.hawkeye-exceptions.yaml` in the repo lets a team pre-approve a specific
  blocked package (with a required `reason`, optional `version`/`ecosystem`,
  `approvedBy`, and an `expires` date) so an otherwise-blocked install proceeds
  — recorded as an `override`, not a silent bypass. Exceptions are a *human*
  artifact (an AI agent benefits but can't grant itself one) and **fail closed**:
  an expired or malformed exception never applies. Set `HAWKEYE_AUDIT_LOG` to
  append a JSONL record of every `check-command` decision (allow / block /
  override, with package, verdict, reason, and approver) — the enterprise hook
  for measuring block rate, override rate, and fix conversion.
- **Machine-actionable remediation for agent self-correction.**
  `check-command` now returns a structured `remediation[]` (in `--json` and in
  the human/hook output): for a fixable vulnerability it names the exact
  `name@version` to install instead, so a blocked AI agent can **retry with the
  safe version** rather than just stopping. Crucially, each proposed upgrade is
  **re-audited before being offered** — if the patched version is itself blocked
  (e.g. it still pulls a vulnerable transitive dependency) the suggestion
  degrades to "find an alternative" instead of sending the agent in circles.
  License blocks and transitive issues route to honest, non-upgrade guidance.

### Performance
- **Cross-process metadata cache (install-guardrail latency).** The install
  guardrail spawns a fresh `hawkeye` process per gated install, so the previous
  in-process LRU was always cold and every install paid the full deps.dev
  fan-out. Immutable, version-pinned deps.dev payloads (and advisory scorecards)
  are now persisted to an on-disk cache shared across processes — a repeat audit
  of `npm install express` drops from ~3.1s to ~0.6s. OSV vulnerability lookups
  are deliberately **never** cached, so a newly-disclosed CVE is never masked;
  only successful responses are stored, so an outage is never cached and
  fail-closed is preserved. Tune with `HAWKEYE_CACHE_DIR` / `HAWKEYE_CACHE_TTL_MS`,
  or disable with `HAWKEYE_NO_CACHE`.

### Added
- **Install guardrail — gate AI-agent package installs (#26).** New
  `hawkeye check-command "<command>"` audits the package(s) an install command
  would add (parsing `npm install`, `pip install`, `cargo add`, …) and exits
  `0`/`1`/`2`. A shipped Claude Code [PreToolUse hook](hooks/claude-code-precheck.mjs)
  uses it to **block** an install with a BLOCKED/UNVERIFIED verdict before it
  runs — a real gate, not a prompt suggestion. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
  Non-install package-manager commands (`npm ci`, `npm test`, `go build`, …) pass
  through untouched. The hook is **fail-closed**: a detected install that Hawkeye
  can't verify (CLI missing, wrong `HAWKEYE_BIN`, or a crash) is blocked, not
  waved through. `HAWKEYE_BIN` may include arguments (e.g.
  `node /abs/dist/cli.js`) so a local dev build works.

### Fixed
- **A non-existent package no longer audits as SAFE.** When deps.dev
  authoritatively has no such package/version (a clean 404), there is no
  metadata to clear it on, so the verdict is now `UNKNOWN` (fail-closed) rather
  than `✅ APPROVED`. This closes a gap where a typo'd or not-yet-indexed name —
  the shape of a typosquat — could pass the install guardrail.

## [1.1.0] - 2026-06-15

### Added
- **`hawkeye scan` — whole-project auditing (#23).** Auto-detects `package.json`
  (NPM) and `requirements.txt` (PyPI), audits every declared dependency with
  bounded concurrency, and aggregates into a single fail-closed verdict with the
  same `0/1/2` exit codes. Supports `--json` and `--sarif` for CI / Code Scanning.
- **SPDX-expression-aware license matching (#12).** License checks now parse
  SPDX expressions instead of exact-string matching: `A AND B` is blocked if
  either side is blocked, while `A OR B` is blocked only if every branch is — so
  a dual license like `(MIT OR GPL-3.0-only)` is no longer falsely flagged, and
  copyleft hidden inside a compound expression is no longer missed. Non-SPDX
  strings fall back to exact match.
- **Configurable vulnerability severity threshold (#13).** Policy now supports
  `minBlockingSeverity` (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW`, default `MEDIUM`)
  so teams choose the lowest severity that blocks a package, instead of the
  hard-coded medium-and-above rule.
- **Machine-readable output: `--json` and `--sarif` (#11).** Emit the structured
  `CheckResult` as JSON or a SARIF 2.1.0 document for GitHub Code Scanning.
  Machine modes keep stdout clean (human chatter goes to stderr) and preserve the
  fail-closed exit codes, so Hawkeye drops into a CI gate as a one-liner.
  Unverifiable sources are surfaced as SARIF `error` results.
- OpenSSF Scorecard, CodeQL, and Dependency Review GitHub Actions workflows.
- `CHANGELOG.md`, `CODEOWNERS`, issue-template chooser config, `.editorconfig`, and `.nvmrc`.
- `scripts/seed-github.sh` to reproduce the project's labels, milestones, and planning issues.
- Vitest test suite (57 tests) covering the fail-closed verdict, timeout/retry,
  bounded concurrency, OSV batch querying, in-flight de-duplication, machine
  output, project scanning, and the pure logic: dependency-graph BFS/pathfinding,
  CVSS severity classification, SPDX license matching, smart upgrade selection,
  and install-command parsing.

### Performance
- **Bounded concurrency, OSV batching, and request de-duplication (#9).**
  Enriching a large dependency graph no longer fans out into hundreds of
  simultaneous requests: deps.dev calls run through a concurrency limiter
  (default 8), transitive vulnerability lookups use OSV `/v1/querybatch` with
  de-duplicated detail hydration instead of one request per dependency,
  concurrent identical requests share a single in-flight fetch, and the
  scorecard lookup reuses already-fetched version info instead of re-fetching.

### Changed
- Pinned all GitHub Actions to commit SHAs (kept current via Dependabot).

### Fixed
- **Fail-closed audit verdict (#7).** Network errors, rate limits (HTTP 429),
  and server errors (5xx) from deps.dev/OSV are no longer silently treated as
  "no findings." The audit now distinguishes `SAFE` / `BLOCKED` / `UNKNOWN`,
  reports which data sources could not be verified, never claims a package is
  clean when a source was unreachable, and exits non-zero on `UNKNOWN`.
- **Request timeouts and retries (#8).** All deps.dev/OSV requests now run
  through a resilient HTTP layer: a 10s per-attempt timeout (no more hanging on
  a stuck connection) and exponential-backoff retry on network errors, 429, and
  5xx. CLI exit codes are now distinct: `0` pass, `1` policy block / unverifiable,
  `2` the tool itself failed to run (usage or unexpected error).

## [1.0.2] - 2025

### Changed
- Migrated to a skill-only CLI workflow and refreshed documentation.
- Normalized README numbering and npm version references.

## [1.0.1] - 2025

### Changed
- Refined the MCP skill workflow and reporting format.

## [1.0.0] - 2025

### Added
- Single-package audit across 7 ecosystems (NPM, PyPI, Go, Cargo, Maven, NuGet, RubyGems).
- License compliance checking with configurable blocklists.
- CVE vulnerability scanning via [OSV.dev](https://osv.dev).
- OpenSSF Scorecard integration with severity-weighted analysis.
- Deep SBOM transitive dependency scanning via [deps.dev](https://deps.dev).
- Automated remediation snippets (upgrade paths, `overrides`, AI-guided alternatives).
- Policy-as-Code via `.audit-agent.yaml`.
- In-memory caching layer with TTL for API responses.

[Unreleased]: https://github.com/ryanHwH20/oss-hawkeye-agent/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/ryanHwH20/oss-hawkeye-agent/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/ryanHwH20/oss-hawkeye-agent/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ryanHwH20/oss-hawkeye-agent/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ryanHwH20/oss-hawkeye-agent/releases/tag/v1.0.0
