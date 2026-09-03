# Agent Harness Architecture

An agent integration should not need to understand Hawkeye's internal scanner
objects before it can answer a simple question: **what is the next permitted
action?** If every adapter interprets that answer independently, integration
speed falls while security drift rises.

Hawkeye therefore exposes one versioned admission contract before adding more
agent surfaces.

## Why this layer exists

The canonical API creates a stable boundary between three responsibilities:

```text
Agent or adapter
    proposes intent
        ↓
Action Runtime
    returns decision + next action
        ↓
Decision Runtime
    evidence + policy → verdict
        ↓
Enforcement
    independently allows or denies the side effect
```

This is not architecture for architecture's sake. It keeps the marginal cost of
a new integration low: VS Code, MCP, CLI, and future adapters consume the same
decision instead of rebuilding Hawkeye's security semantics.

## Canonical one-shot API

```ts
import { assessAction } from 'oss-hawkeye-agent';

const assessment = await assessAction({
  kind: 'shell_command',
  command: 'npm install axios@1.7.2',
  cwd: '/workspace',
});
```

An applicable action returns:

```ts
interface AdmissionDecision {
  schemaVersion: 1;
  id: string;
  subject: ActionIntent;
  packages: PackageCoordinate[];
  rawVerdict: 'SAFE' | 'BLOCKED' | 'UNKNOWN';
  effectiveVerdict: 'SAFE' | 'BLOCKED' | 'UNKNOWN';
  findings: Finding[];
  evidence: EvidenceRef[];
  errors: HawkeyeError[];
  overrides: AppliedOverride[];
  remediation: RemediationCandidate[];
  policy: { id?: string; digest: string };
  decidedAt: string;
}
```

`rawVerdict` preserves what Hawkeye found. `effectiveVerdict` records the
enforced result after a trusted exception. Keeping both is essential: accepted
risk remains visible risk.

## Decision Kernel

An audit is easier to trust when it can answer two questions separately:

1. What did Hawkeye observe?
2. What did organization policy decide about those observations?

PR2 makes that boundary explicit:

```text
collectPackageEvidence()
    network, cache, provider normalization
                ↓
          PackageEvidence
                ↓
evaluatePackage(evidence, policy)
    deterministic, side-effect-free policy evaluation
                ↓
           CheckResult
```

`PackageEvidence` retains source availability, trust, provenance, dependency
evidence, and the exact package coordinate. It contains no verdict.
`evaluatePackage()` performs no network, filesystem, cache, clock, or random
access. This lets a security team replay the same observations against a policy
change and distinguish a provider outage from a policy violation.

`assessPackage()` composes both steps for new integrations. The established
`checkPackage()` API remains a compatibility facade over the same path, so CLI,
scan, daemon, adapter, remediation, and telemetry consumers do not gain a
second interpretation of package risk.

Collected evidence and `EvidenceRef` have different jobs. The former carries
the payload needed by the Decision Kernel; the latter is a stable, transport-
friendly reference embedded in `AdmissionDecision`.

The policy digest is computed from normalized policy meaning, not YAML or JSON
formatting. Two equivalent policies produce the same identity, while a material
policy change produces a different digest.

## Structured next actions

The one-shot runtime currently maps a decision to one action:

| Decision | Next action |
| :-- | :-- |
| Effective `SAFE` | `EXECUTE_ALLOWED_ACTION` |
| `BLOCKED` with a re-audited clean version | `TRY_VERIFIED_REMEDIATION` |
| Retryable evidence outage | `RETRY` |
| No verified fix, approval workflow configured | `REQUEST_HUMAN_APPROVAL` |
| No safe recovery | `STOP` |

This one-shot plan is also the input to Harness V1. The Harness preserves it
instead of rebuilding policy or remediation logic.

## Harness V1: resumable workflow

One assessment is enough for a synchronous hook, but not for an agent that may
retry, pause for approval, or resume in another process. Harness V1 exposes a
versioned state machine for that operating lifecycle:

```ts
import { createRun, nextAction, submitResult } from 'oss-hawkeye-agent';

const state = createRun(intent, policyRef, { runId: 'run-123' });
const action = nextAction(state);
const updated = submitResult(state, action.id, result);
```

`HawkeyeRunState` contains the original intent and policy identity, canonical
decisions, attempt budget, action history, approval requests, and current phase.
It is JSON serializable and contains no conversation or hidden model state.
After a JSON round-trip, the same state produces the same action and ID.

`nextAction()` is a pure planner. `submitResult()` is an immutable reducer that
accepts only the exact pending action and matching result schema. Stale,
duplicate, out-of-order, malformed, wrong-command, intent-mismatched, and
policy-mismatched submissions fail with a structured `HarnessError`.

Retryable `UNKNOWN` decisions use a finite assessment budget (three by default).
Exhaustion produces `STOP`, preventing a provider outage from becoming an
unbounded agent loop.

### Approval is not agent authority

An `APPROVAL_REQUESTED` result records only that a governed request was handed
off. It does not change `BLOCKED` to `SAFE`, and arbitrary `approved: true`
fields are rejected by runtime result validation. A trusted exception must be
recorded outside the Harness and the original action reassessed.

### Execution reports are not enforcement receipts

An `EXECUTION_COMPLETED` result records workflow progress. It is not a
cryptographic attestation and does not grant permission. The package-manager
command in an allowed or verified-remediation plan still passes through normal
Hawkeye enforcement. Harness V1 standardizes orchestration while enforcement
remains the final security authority.

## Not applicable is not safe

`npm test` and `git status` do not represent supported package-install intents.
They return:

```json
{
  "schemaVersion": 1,
  "applicability": "not_applicable"
}
```

They do not receive an authoritative `SAFE` admission decision. This distinction
prevents a parser miss from being presented as a completed security assessment.

## Compatibility during migration

Existing integrations continue to receive `CommandAudit`:

```text
check-command / hook / daemon
            ↓
      auditCommand()
            ↓
      assessAction()
            ↓
 legacy CommandAudit projection
```

CLI output, exit codes, SARIF, scan reports, exceptions, remediation, daemon
fallback, and audit telemetry retain their current contracts. The compatibility
projection can be removed only through an explicit future compatibility plan.

## Security boundary

An `ActionPlan` is guidance, not permission. A recommended command still passes
through PreToolUse, a shell shim, or another enforcement interceptor before any
package-manager side effect occurs.

The invariant remains simple:

> Hawkeye owns the verdict. The coding agent owns task execution.

The contract makes that relationship easier to integrate without quietly giving
the agent more authority.
