# PR1 Maintainer UAT — Canonical Agent Contract

PR1 is not accepted merely because TypeScript compiles. The business outcome is
that every future agent integration can consume one stable Hawkeye decision,
without rebuilding policy semantics or silently treating an unsupported command
as safe.

This UAT confirms that promise from a maintainer's point of view. It does not
install any package.

## Acceptance scope

| Outcome to accept | Why it matters |
| --- | --- |
| The npm package exposes one canonical API | Integrators should not depend on Hawkeye's internal file layout. |
| Existing checker exports remain available | PR1 must not force current consumers into an unplanned migration. |
| Equivalent policies have a stable identity | Audit records should change when policy meaning changes, not when formatting changes. |
| Unsupported actions return `not_applicable` | A parser miss must never be misrepresented as security approval. |
| Explicit versions survive across seven ecosystems | Hawkeye must assess what the developer requested, not a moving `latest` version. |
| Every applicable decision contains one next action | An agent should know whether to execute, retry, remediate, request approval, or stop. |

## 1. Start from a reviewable checkout

Run this from the PR1 branch:

```bash
npm install
git status --short
```

Confirm that dependency installation did not introduce an unexpected lockfile
change. Existing PR1 source changes are expected until the branch is committed.

## 2. Run the maintainer UAT

```bash
npm run uat:pr1
```

The command builds the package and uses the compiled public entrypoint. It then
assesses one command for each supported ecosystem:

- NPM, including the JavaScript / TypeScript package coordinate
- PyPI
- Cargo
- Go
- RubyGems
- NuGet
- Maven

Expected observations:

- The last summary says `UAT PASSED`, not `UAT INCONCLUSIVE`.
- Every row contains the expected ecosystem, package name, and explicit version.
- Every row has a `raw`, `effective`, and `nextAction` value.
- The policy digest starts with `sha256:`.
- `npm test` and `dotnet remove package ...` are checked as `not_applicable`.

`SAFE` and `BLOCKED` are live security observations. They may change as package
metadata and vulnerabilities change, so do not fail UAT because one differs
from an older screenshot. `UNKNOWN` correctly proves fail-closed behavior, but
it does not prove that the live evidence integration worked; the script reports
the run as inconclusive and asks you to retry with network access.

## 3. Inspect one canonical decision in full

Choose any command from the UAT table and run:

```bash
node --input-type=module -e "import('./dist/index.js').then(async ({ assessAction }) => console.log(JSON.stringify(await assessAction({ kind: 'shell_command', command: 'pip install idna==3.7', cwd: process.cwd() }), null, 2)))"
```

For an applicable result, confirm:

- `schemaVersion` is `1` at both assessment and decision levels.
- `subject.command` is the command you submitted.
- `packages[0]` contains `PYPI`, `idna`, and requested version `3.7`.
- `rawVerdict` remains visible even when an exception changes `effectiveVerdict`.
- `findings`, `evidence`, `errors`, `overrides`, and `remediation` are arrays.
- `nextAction.kind` is exactly one actionable outcome.

## 4. Confirm the compatibility path

```bash
node dist/cli.js check-command "pip install idna==3.7" --json
```

Confirm that the existing CLI still returns the legacy `CommandAudit` shape with
`detected: true`, `system: "PYPI"`, and version `3.7`. A non-zero exit code is
valid when the live verdict is `BLOCKED` or `UNKNOWN`; fail-closed behavior is an
existing security contract, not a UAT failure.

Then run the negative case:

```bash
node dist/cli.js check-command "dotnet remove package Newtonsoft.Json" --json
```

Confirm `detected: false`. Removal must not be treated as an install request.

## 5. Run the engineering regression suite

```bash
npm test
npm pack --dry-run
git diff --check
```

Confirm that tests pass, the package preview contains `dist/index.js` and its
type declarations, and Git reports no whitespace errors.

## UAT sign-off record

Record these items in the pull request:

```text
UAT owner:
Date / timezone:
Commit SHA:
Node / npm versions:
PR1 UAT result: PASS / FAIL
Observed live verdict exceptions:
Notes or screenshots:
```

The point of this handoff is not to make the maintainer repeat CI. It gives the
person accountable for the release a direct view of the contract users and
agent integrations will actually receive.
