# PR3 Maintainer UAT — Agent Harness V1

PR3 is accepted when a maintainer can demonstrate that an agent workflow can be
serialized, resumed, and advanced only through the one action Hawkeye expects.
The business outcome is not merely a new state type: every future adapter gets
the same bounded recovery and audit behavior instead of implementing its own.

## 1. Run the seven-ecosystem workflow UAT

```bash
npm run uat:pr3
```

The runner builds the package and performs live assessments for NPM, PyPI,
Cargo, Go, RubyGems, NuGet, and Maven. It then submits simulated workflow
results. It **never runs** the displayed package-manager command and never
installs a dependency.

For every row, confirm:

- the ecosystem and exact package coordinate are correct;
- `action` is a valid Hawkeye action rather than free-form agent prose;
- `replay` is `yes`, proving JSON restore produces the same next action;
- `phase` matches the simulated result;
- the final summary is `UAT PASSED`.

`SAFE`, `BLOCKED`, and `UNKNOWN` are live observations and can change with
upstream evidence. PR3 acceptance checks that all of them enter the correct
workflow; it does not freeze a package's current verdict.

## 2. Inspect a resumable state

```bash
node --input-type=module - <<'NODE'
import { createRun, nextAction } from './dist/index.js';

const state = createRun(
  { kind: 'shell_command', command: 'npm install is-number@7.0.0' },
  { digest: 'sha256:uat-policy' },
  {
    runId: 'maintainer-demo',
    now: () => new Date('2026-09-03T08:00:00.000Z'),
  },
);

const restored = JSON.parse(JSON.stringify(state));
console.log(JSON.stringify(state, null, 2));
console.log(nextAction(restored));
NODE
```

Confirm the state contains no conversation text or hidden LLM state and that
the next action ID is `maintainer-demo:action:1:assess`.

## 3. Inspect protocol rejection and retry bounds

The UAT summary must state:

```text
Protocol checks: stale action rejected; retry budget stops after 2 assessments.
```

These checks protect two concrete operating costs: a delayed adapter cannot
apply an old result to a newer workflow, and a provider outage cannot consume
agent time indefinitely.

For the full negative-path suite, run:

```bash
npx vitest run test/harness/harness.test.ts
```

It also covers malformed results, wrong result kinds, mismatched commands,
intent/policy mismatches, terminal runs, unverified remediation, execution
failure, and non-authoritative approval requests.

## 4. Run regression and packaging gates

```bash
npm run build
npm test
npm pack --dry-run
git diff --check
```

Confirm the published package contains `dist/harness/`, public declarations,
and the Harness architecture document while all legacy behavior remains green.

## UAT sign-off record

```text
UAT owner:
Date / timezone:
Commit SHA:
Node / npm versions:
PR3 UAT result: PASS / FAIL
Seven ecosystem rows reviewed: YES / NO
Stale-result rejection reviewed: YES / NO
Retry exhaustion reviewed: YES / NO
Notes or screenshots:
```
