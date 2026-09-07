# PR8 Maintainer UAT — Release Supply-Chain Isolation

## Business outcome

This UAT accepts that a public Hawkeye release cannot reach npm until the exact
artifact has passed unit tests, package checks, and live assessment across all
seven supported ecosystems. It also confirms that dependency installation and
build scripts do not run in the job that holds npm OIDC publishing authority.

## Safety boundary

The UAT creates and installs local tarballs with npm lifecycle scripts disabled.
It does not call `npm publish`, create a Git tag or GitHub Release, change npm
dist-tags, or mutate the `npm-production` environment.

## Run

From the repository root:

```bash
npm run uat:pr8
```

The command first runs PR7's clean-consumer UAT for:

- NPM
- PyPI
- Cargo
- Go
- RubyGems
- NuGet
- Maven

It then runs the release workflow contract tests and independently checks:

1. Node.js and npm release versions are exact pins rather than `latest`.
2. The validation job has no OIDC token permission.
3. All seven ecosystems are tested before the artifact is uploaded.
4. Only the dependent publish job receives `id-token: write`.
5. The publish job runs no `npm ci`, project build command, or npm lifecycle
   script.
6. Checkout does not persist GitHub credentials.
7. Every third-party Action uses a full commit SHA.
8. Post-publish validation is bounded and requires version, commit, integrity,
   and SLSA provenance to match.
9. A real local tarball's recomputed SHA-512 equals npm's package integrity.

## Expected result

- PR7 prints seven rows with `installed: yes` and `deterministic: yes`.
- Release workflow tests pass.
- Every PR8 trust-boundary row reports `PASS`.
- The final lines are:

  ```text
  UAT PASSED: release validation and OIDC publishing are isolated by an integrity-checked artifact.
  No package was published.
  ```

## What cannot be proven before merge

GitHub OIDC and npm provenance exist only inside the configured cloud release
workflow. This PR intentionally does not publish a test version. After this PR
is merged, a separately approved release must prove the `npm-production`
approval gate, trusted publisher configuration, and public attestation endpoint
end to end.
