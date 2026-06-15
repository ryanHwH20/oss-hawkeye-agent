# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
