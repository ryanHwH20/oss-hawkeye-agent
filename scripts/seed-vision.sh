#!/usr/bin/env bash
#
# seed-vision.sh — Create the strategic milestones and issues for the project
# vision (distribution + AI-agent guardrail). Idempotent: milestones and issues
# are created only if a matching title does not already exist.
#
# Prerequisites: `gh auth login`, run from the repo root.
# Usage: bash scripts/seed-vision.sh

set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"

if ! gh auth status >/dev/null 2>&1; then
  echo "error: not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
echo "==> Target repository: ${REPO}"

# ─── Milestones ──────────────────────────────────────────────────────────────
ensure_milestone() {
  local title="$1" desc="$2" existing
  existing="$(gh api "repos/${REPO}/milestones?state=all" --jq ".[] | select(.title==\"${title}\") | .title" 2>/dev/null || true)"
  if [ -n "${existing}" ]; then echo "    milestone exists: ${title}"; else
    gh api "repos/${REPO}/milestones" -f title="${title}" -f description="${desc}" >/dev/null
    echo "    milestone: ${title}"
  fi
}

echo "==> Milestones"
ensure_milestone "v1.3 — Meet Developers Where They Are" "Whole-repo scanning, official GitHub Action with PR comments, and frictionless distribution. Turn Hawkeye from a per-package curiosity into a CI/PR workflow."
ensure_milestone "v2.0 — AI-Agent Guardrail" "Become the enforced supply-chain gate inside the AI coding-agent loop, plus the differentiation the data providers don't offer (malware/typosquat, auto-remediation, shared policy)."

# ─── Issues ──────────────────────────────────────────────────────────────────
create_issue() {
  local title="$1" milestone="$2" labels="$3" body="$4" existing
  existing="$(gh issue list --state all --search "\"${title}\" in:title" --json title --jq ".[] | select(.title==\"${title}\") | .title" 2>/dev/null || true)"
  if [ -n "${existing}" ]; then echo "    issue exists: ${title}"; return; fi
  gh issue create --title "${title}" --milestone "${milestone}" --label "${labels}" --body "${body}" >/dev/null
  echo "    issue: ${title}"
}

echo "==> Issues"

# ── v1.3 — adoption engine ──
create_issue \
  "[feat] hawkeye scan — audit a whole project manifest" \
  "v1.3 — Meet Developers Where They Are" \
  "type: feature,priority: P1,area: cli" \
"## Why
Auditing one package at a time makes Hawkeye a curiosity, not a workflow. The single biggest adoption unlock is \"point it at my repo and it scans everything.\"

## Scope
- New \`hawkeye scan\` command that auto-detects and audits project manifests: \`package.json\`, \`requirements.txt\`, \`go.mod\`, \`Cargo.toml\`, \`pom.xml\`.
- Aggregate verdict across all dependencies; reuse the bounded-concurrency + OSV batch paths from #9.
- Respect the three-state fail-closed verdict and exit codes from #7/#8.

## Acceptance criteria
- [ ] \`hawkeye scan [path]\` detects and parses at least npm + PyPI manifests
- [ ] Aggregated report + summary verdict
- [ ] Honors \`.audit-agent.yaml\` policy
- [ ] Exit code: 0 clean, 1 blocked/unverifiable, 2 tool error
- [ ] Tests for manifest parsing and aggregation"

create_issue \
  "[feat] Official GitHub Action + PR comment bot" \
  "v1.3 — Meet Developers Where They Are" \
  "type: feature,priority: P1,area: ci" \
"## Why
Meet developers in the PR. Zero-install adoption: drop the Action in, get a security verdict commented on every PR.

## Scope
- Publish a composite/Docker GitHub Action (\`uses: ryanHwH20/hawkeye-action@v1\`).
- Run \`hawkeye scan\` on changed manifests; post a summary as a PR comment.
- Optionally fail the check on blocking/unverifiable findings (configurable).
- Emit SARIF (depends on #11) for the Security tab.

## Acceptance criteria
- [ ] Action runs scan and comments on the PR
- [ ] Configurable fail-on-severity
- [ ] Documented usage in README"

create_issue \
  "[feat] Frictionless distribution: npx, Docker image, pre-commit hook" \
  "v1.3 — Meet Developers Where They Are" \
  "type: feature,priority: P2,area: ci" \
"## Why
Install friction is the top adoption killer. Make trying Hawkeye a one-liner.

## Scope
- \`npx oss-hawkeye-agent <args>\` works without a global install (verify bin wiring).
- Publish a minimal Docker image for CI use.
- Provide a \`.pre-commit-hooks.yaml\` so teams can gate commits locally.

## Acceptance criteria
- [ ] \`npx oss-hawkeye-agent NPM lodash\` works from a clean machine
- [ ] Docker image published and documented
- [ ] pre-commit hook documented"

# ── v2.0 — differentiation / moat ──
create_issue \
  "[feat] MCP server: enforce Hawkeye audit on AI-agent install/tool calls" \
  "v2.0 — AI-Agent Guardrail" \
  "type: feature,priority: P1,area: cli" \
"## Why
The differentiation wedge. As AI agents write code and install packages, a gate the agent **must** pass — technically, not by prompt cooperation — is an emerging, largely unoccupied niche. Hawkeye's fail-closed verdict + exit codes are already the right primitive.

## Scope
- Expose Hawkeye as an MCP server with an \`audit_package\` / \`audit_install\` tool.
- The agent's install/tool action is gated on a passing audit (or an explicit, logged bypass).
- Reuses the existing checker; no prompt-only enforcement.

## Acceptance criteria
- [ ] MCP server exposes an audit tool returning the structured verdict
- [ ] Documented wiring for at least one MCP client
- [ ] Bypass requires explicit, logged acknowledgement"

create_issue \
  "[feat] AI-assisted automated remediation PRs" \
  "v2.0 — AI-Agent Guardrail" \
  "type: feature,priority: P2,area: core" \
"## Why
Close the loop: when a package is blocked, don't just report — open the fix.

## Scope
- Given a blocking finding with a known patched version / override, generate a branch + PR that applies the upgrade or \`overrides\` block.
- Reuse \`findSmartUpgrades\` for minimal-vs-latest selection.

## Acceptance criteria
- [ ] Generates a valid manifest change for a known-vulnerable dependency
- [ ] Opens (or prints) a ready-to-apply PR/diff
- [ ] Tests for the generated change"

create_issue \
  "[feat] Malware / typosquat detection signal" \
  "v2.0 — AI-Agent Guardrail" \
  "type: feature,priority: P1,area: core" \
"## Why
Known CVEs are commoditized; the real supply-chain threat has moved to malicious and typosquatted packages. This is the data/algorithm gap that turns Hawkeye from a deps.dev front-end into something defensible.

## Scope
- Add a malicious/typosquat risk signal (e.g. name-similarity to popular packages, install-script heuristics, known-malicious advisory sources).
- Surface as a first-class finding type with its own severity.

## Acceptance criteria
- [ ] Typosquat name-similarity check against a popular-package list
- [ ] New finding type rendered in the report and factored into the verdict
- [ ] Tests for the detection heuristics"

create_issue \
  "[feat] Shared policy registry (fintech-strict, startup-relaxed)" \
  "v2.0 — AI-Agent Guardrail" \
  "type: feature,priority: P2,area: core" \
"## Why
Organizations want policy-as-code they can adopt, not author from scratch. Community-maintained policy templates lower the barrier and create network effects.

## Scope
- Define a small set of named policy presets (e.g. \`fintech-strict\`, \`startup-relaxed\`).
- Allow \`.audit-agent.yaml\` to \`extends:\` a preset.

## Acceptance criteria
- [ ] At least two presets shipped
- [ ] \`extends\` resolution with local overrides
- [ ] Tests for preset merge semantics"

# ── Trust / hygiene ──
create_issue \
  "[chore] SLSA provenance + signed releases" \
  "Backlog — Engineering Hygiene" \
  "type: chore,priority: P2,area: ci" \
"## Why
A supply-chain security tool must be a supply-chain exemplar. Release already uses npm --provenance; go further so adopters can verify what they run.

## Scope
- Add SLSA build provenance to the release workflow.
- Document how to verify provenance/signatures.

## Acceptance criteria
- [ ] Release artifacts carry verifiable provenance
- [ ] Verification steps documented in SECURITY.md / README"

echo ""
echo "==> Done. Review at: https://github.com/${REPO}/issues and /milestones"
