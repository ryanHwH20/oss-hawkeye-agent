#!/usr/bin/env bash
#
# seed-github.sh — One-shot bootstrap of the project's GitHub planning structure.
#
# Creates labels, milestones, and the initial issue backlog so the repository
# presents as a well-planned open-source project. Safe to re-run: labels are
# upserted (--force), milestones are created only if the title does not exist,
# and issues are created only if no open issue with the same title exists.
#
# Prerequisites:
#   - GitHub CLI installed and authenticated: `gh auth login`
#   - Run from the repository root.
#
# Usage:
#   bash scripts/seed-github.sh

set -euo pipefail

# Ensure brew-installed gh is on PATH for non-login shells.
export PATH="/opt/homebrew/bin:$PATH"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) not found. Install with 'brew install gh'." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
echo "==> Target repository: ${REPO}"

# ─── Labels ──────────────────────────────────────────────────────────────────
echo "==> Creating labels"
upsert_label() {
  gh label create "$1" --color "$2" --description "$3" --force >/dev/null
  echo "    label: $1"
}

upsert_label "type: bug"        "d73a4a" "Something is broken or behaves incorrectly"
upsert_label "type: feature"    "0e8a16" "New capability or enhancement"
upsert_label "type: test"       "1d76db" "Test coverage and tooling"
upsert_label "type: chore"      "cfd3d7" "Maintenance, tooling, hygiene"
upsert_label "priority: P0"     "b60205" "Critical — correctness/security of the tool itself"
upsert_label "priority: P1"     "d93f0b" "High — needed for real-world usability"
upsert_label "priority: P2"     "fbca04" "Normal — valuable improvement"
upsert_label "area: api"        "5319e7" "External API layer (deps.dev / OSV)"
upsert_label "area: core"       "0052cc" "Audit engine and policy logic"
upsert_label "area: cli"        "006b75" "CLI surface and output formats"
upsert_label "area: ci"         "bfdadc" "CI, build, and packaging"
upsert_label "good first issue" "7057ff" "Good for newcomers"
upsert_label "help wanted"      "008672" "Community contributions welcome"

# ─── Milestones ──────────────────────────────────────────────────────────────
echo "==> Creating milestones"
ensure_milestone() {
  local title="$1" desc="$2"
  local existing
  existing="$(gh api "repos/${REPO}/milestones?state=all" --jq ".[] | select(.title==\"${title}\") | .title" 2>/dev/null || true)"
  if [ -n "${existing}" ]; then
    echo "    milestone exists: ${title}"
  else
    gh api "repos/${REPO}/milestones" -f title="${title}" -f description="${desc}" >/dev/null
    echo "    milestone: ${title}"
  fi
}

ensure_milestone "v1.1 — Trustworthy Core"        "Fix fail-open behavior and concurrency blowups. Make the verdict trustworthy."
ensure_milestone "v1.2 — CI-Ready Integration"    "Machine-readable output, SPDX-aware licensing, configurable policy. Make it pipeline-ready."
ensure_milestone "Backlog — Engineering Hygiene"  "Tooling, dead-code removal, linting, packaging guards."

# ─── Issues ──────────────────────────────────────────────────────────────────
echo "==> Creating issues"
create_issue() {
  local title="$1" milestone="$2" labels="$3" body="$4"
  local existing
  existing="$(gh issue list --state all --search "\"${title}\" in:title" --json title --jq ".[] | select(.title==\"${title}\") | .title" 2>/dev/null || true)"
  if [ -n "${existing}" ]; then
    echo "    issue exists: ${title}"
    return
  fi
  gh issue create --title "${title}" --milestone "${milestone}" --label "${labels}" --body "${body}" >/dev/null
  echo "    issue: ${title}"
}

create_issue \
  "[P0] Fail-closed on data-fetch failure (three-state verdict)" \
  "v1.1 — Trustworthy Core" \
  "type: bug,priority: P0,area: core" \
"## Problem
\`fetchJson\` in \`src/api/deps-dev.ts\` and the \`catch\` in \`src/api/osv.ts\` swallow **all** network errors and return \`null\` / \`[]\`. When an API is down, rate-limited, or unreachable, the report shows \"✅ No known vulnerabilities\" and the package is **approved**. A security guardrail that fails open is the cardinal sin — the umpire didn't see the ball and called it *in*.

## Proposed change
- Introduce an explicit verdict state: \`SAFE\` / \`BLOCKED\` / \`UNKNOWN\`.
- \`UNKNOWN\` (data could not be retrieved) is treated as **blocking** by default and the report clearly states \"this conclusion is based on incomplete data.\"
- A \`null\` Scorecard score must no longer silently pass.

## Acceptance criteria
- [ ] Fetch failures propagate as \`UNKNOWN\`, not silent success.
- [ ] Report renders an explicit \"unverified\" banner when any data source failed.
- [ ] Unit tests cover the fail-closed path with a mocked failing API.

## References
- \`src/api/deps-dev.ts\` (fetchJson)
- \`src/api/osv.ts\` (queryVulnerabilities catch)
- \`src/checker.ts\` (scorecard null handling)"

create_issue \
  "[P0] Add fetch timeout + retry with exponential backoff" \
  "v1.1 — Trustworthy Core" \
  "type: bug,priority: P0,area: api" \
"## Problem
\`fetch\` calls have no timeout, so a single hung connection blocks the entire CLI indefinitely. There is no retry on transient failures.

## Acceptance criteria
- [ ] All fetches wrapped with \`AbortController\` (default 10s timeout).
- [ ] Exponential backoff retry (max 3) on 5xx / network errors.
- [ ] \`src/cli.ts\` exit codes are distinguished: policy block = \`1\`, execution/network error = \`2\`.

## References
- \`src/api/deps-dev.ts\`, \`src/api/osv.ts\`, \`src/cli.ts\`

Depends on / pairs with the three-state verdict work."

create_issue \
  "[P1] Bounded concurrency + OSV querybatch + in-flight dedup" \
  "v1.1 — Trustworthy Core" \
  "type: feature,priority: P1,area: api" \
"## Problem
\`checker.ts\` fans out an unbounded \`Promise.all\` over every dependency, each triggering 2–3 more fetches. A package with hundreds of transitive deps issues hundreds-to-thousands of concurrent requests, which get rate-limited and then trigger the fail-open path. OSV is also queried one-by-one instead of via its batch endpoint.

## Acceptance criteria
- [ ] Concurrency limited via a semaphore (default 8).
- [ ] Vulnerability lookups use OSV \`/v1/querybatch\`.
- [ ] In-flight request de-duplication (diamond deps fetch each URL once).
- [ ] Remove the redundant version-info fetch inside \`getScorecard\`.

## References
- \`src/checker.ts\` (per-dep Promise.all)
- \`src/api/osv.ts\`, \`src/api/deps-dev.ts\`"

create_issue \
  "[P1] Introduce Vitest + unit tests for pure logic" \
  "v1.1 — Trustworthy Core" \
  "type: test,priority: P1,area: core" \
"## Problem
The only tests hit live APIs, are non-deterministic, and CI smoke checks would not even catch the fail-open bug. The highest-value pure logic is untested.

## Acceptance criteria
- [ ] Vitest added; \`npm test\` runs in CI.
- [ ] API layer abstracted behind an injectable interface and mocked.
- [ ] Unit tests for: severity mapping, BFS dependency-path, \`findSmartUpgrades\` (semver), and the command parser.
- [ ] Live-API tests tagged \`integration\` and excluded from the PR gate.

## References
- \`src/checker.ts\`, \`src/formatter.ts\`, \`src/parser.ts\`, \`scripts/smoke.mjs\`"

create_issue \
  "[P1] Machine-readable output: --json / --sarif" \
  "v1.2 — CI-Ready Integration" \
  "type: feature,priority: P1,area: cli" \
"## Motivation
Output is currently human-readable Markdown only, so the tool cannot act as a real CI gate. The exit code is the only machine signal.

## Acceptance criteria
- [ ] \`--json\` emits the structured \`CheckResult\`.
- [ ] \`--sarif\` emits SARIF for GitHub Code Scanning.
- [ ] README documents a CI integration example.

## References
- \`src/cli.ts\`, \`src/formatter.ts\`, \`src/types.ts\`"

create_issue \
  "[P2] SPDX-expression-aware license matching" \
  "v1.2 — CI-Ready Integration" \
  "type: feature,priority: P2,area: core,good first issue" \
"## Problem
\`checker.ts\` matches licenses with exact string \`includes()\`. Real licenses are SPDX expressions such as \`(MIT OR GPL-3.0-only)\` — a copyleft term hidden in a dual license is never matched and slips through.

## Acceptance criteria
- [ ] Use \`spdx-expression-parse\` to evaluate expressions.
- [ ] Correct \`OR\` (a compliant alternative is acceptable) and \`AND\` (all must comply) semantics.
- [ ] Unit tests for compound expressions.

## References
- \`src/checker.ts\` (rootFlaggedLicenses / flagged)"

create_issue \
  "[P2] Configurable severity threshold in policy" \
  "v1.2 — CI-Ready Integration" \
  "type: feature,priority: P2,area: core" \
"## Problem
Vulnerability blocking is a boolean and MEDIUM is always treated as blocking. The variable \`critHighVulns\` includes MEDIUM, so naming and behavior disagree.

## Acceptance criteria
- [ ] Policy gains \`minBlockingSeverity\` (and/or a CVSS threshold).
- [ ] Rename misleading variables.
- [ ] README policy example updated.

## References
- \`src/checker.ts\`, \`src/types.ts\` (Policy), \`policy.json\`"

create_issue \
  "[chore] Engineering hygiene sweep" \
  "Backlog — Engineering Hygiene" \
  "type: chore,priority: P2,area: ci,good first issue" \
"## Scope
A single pass of housekeeping that makes the project read as professionally maintained.

## Checklist
- [ ] Move \`@types/node\` from \`dependencies\` to \`devDependencies\`.
- [ ] Resolve dead code: \`src/parser.ts\` is not wired to the CLI and \`checkPackages\` is unused — wire up batch auditing or remove.
- [ ] Add ESLint + Prettier and a CI lint step.
- [ ] Add \`prepublishOnly: npm run build\` to guard against publishing stale \`dist\`.
- [ ] Inject policy into the formatter instead of the import-time \`loadPolicy()\` side effect in \`src/formatter.ts\`.

## References
- \`package.json\`, \`src/parser.ts\`, \`src/checker.ts\`, \`src/formatter.ts\`"

echo ""
echo "==> Done. Review at: https://github.com/${REPO}/issues"
