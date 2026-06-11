# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- OpenSSF Scorecard, CodeQL, and Dependency Review GitHub Actions workflows.
- `CHANGELOG.md`, `CODEOWNERS`, issue-template chooser config, `.editorconfig`, and `.nvmrc`.
- `scripts/seed-github.sh` to reproduce the project's labels, milestones, and planning issues.

### Changed
- Pinned all GitHub Actions to commit SHAs (kept current via Dependabot).

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

[Unreleased]: https://github.com/ryanHwH20/oss-hawkeye-agent/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/ryanHwH20/oss-hawkeye-agent/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ryanHwH20/oss-hawkeye-agent/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ryanHwH20/oss-hawkeye-agent/releases/tag/v1.0.0
