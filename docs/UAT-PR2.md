# PR2 Maintainer UAT — Decision Kernel

PR2 is accepted when a maintainer can see that Hawkeye separates provider facts
from organization policy without changing the decision current users receive.
A green unit suite is necessary, but the product promise is stronger: evidence
must be inspectable, evaluation must be repeatable, and the compatibility API
must agree across every supported ecosystem.

## 1. Run the live seven-ecosystem UAT

```bash
npm run uat:pr2
```

The runner builds the package, imports the compiled public entrypoint, and then
checks NPM, PyPI, Cargo, Go, RubyGems, NuGet, and Maven. It does not execute any
package manager or install a dependency.

For every row, confirm:

- package system, name, and explicit version are correct;
- metadata, dependency graph, OSV, and Scorecard status are visible;
- `deterministic` is `yes`;
- `compatible` is `yes`;
- the final summary is `UAT PASSED`.

`SAFE` and `BLOCKED` are live observations and may change with upstream data.
An unavailable provider produces `UAT INCONCLUSIVE`, because correct
fail-closed behavior does not prove that the live evidence path worked.

## 2. Inspect evidence without a verdict

```bash
node --input-type=module -e "import('./dist/index.js').then(async ({ collectPackageEvidence }) => console.log(JSON.stringify(await collectPackageEvidence({ system: 'NPM', name: 'is-number', version: '7.0.0' }), null, 2)))"
```

Confirm the result contains `subject`, `metadata`, `dependencyGraph`,
`vulnerabilities`, `scorecard`, `dependencies`, `typosquat`, provenance, and
links—but no `verdict` property. Providers report observations; they do not
grant permission.

## 3. Inspect deterministic policy evaluation

Run the full automated kernel tests:

```bash
npx vitest run test/core/evaluate-package.test.ts test/runtime/collect-package-evidence.test.ts
```

These fixtures prove that the same evidence can be evaluated repeatedly and
against different policies without recollection. They also cover provider
outage versus authoritative not-found, Scorecard advisory behavior, malware,
transitive risk, and typosquat policy.

## 4. Run the regression and packaging gates

```bash
npm run build
npm test
npm pack --dry-run
git diff --check
```

Confirm existing CLI, scan, daemon, adapter, SARIF, exception, remediation, and
telemetry tests remain green, and the published package contains the Decision
Kernel modules and public type declarations.

## UAT sign-off record

```text
UAT owner:
Date / timezone:
Commit SHA:
Node / npm versions:
PR2 UAT result: PASS / FAIL
Observed live verdict exceptions:
Unavailable evidence sources:
Notes or screenshots:
```

This handoff protects the human accountable for the release from a subtle kind
of regression: a refactor that looks cleaner internally but changes what the
security gate tells developers in practice.
