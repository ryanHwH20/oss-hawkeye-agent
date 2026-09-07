# Releasing Hawkeye

This runbook is the canonical maintainer process for public npm releases. Its
goal is to make every release repeatable, reviewable, and attributable to the
exact source commit that produced it.

## Release trust boundary

The release workflow has two jobs:

1. `validate-and-pack` has read-only repository access and no OIDC permission.
   It installs dependencies, builds Hawkeye, runs the full test and UAT gates,
   and creates one npm tarball plus its SHA-512 checksum.
2. `publish-npm` is the only job with `id-token: write`. It checks out the
   release tag without persisting GitHub credentials so npm can record release
   identity, but it does not install project dependencies or run build scripts.
   It downloads the validated artifact, verifies its checksum, and publishes
   that exact tarball through npm trusted publishing with lifecycle scripts
   disabled.

Configure the `npm-production` GitHub Environment with required reviewers. The
npm trusted publisher must match this repository and `release.yml`; if the npm
configuration specifies an environment, it must be `npm-production`.

## 1. Prepare through a pull request

1. Open a release Issue describing user value, compatibility, migration notes,
   validation, and explicit non-goals.
2. Create a release branch from current `main`.
3. Update `package.json`, `package-lock.json`, MCP server metadata, and
   `CHANGELOG.md` to the same semantic version.
4. Run:

   ```bash
   npm ci
   npm test
   npm run check:release-version -- vX.Y.Z
   npm run uat:pr7
   npm run check:setup
   npm run check:smoke
   npm audit
   ```

5. Record the results in the PR. Obtain maintainer UAT and review before merge.

## 2. Create and review a draft release

1. Sync local `main` after the release PR merges.
2. Confirm `HEAD`, `origin/main`, and the intended release commit are identical.
3. Confirm the version is not already present on npm or as a Git tag.
4. Create a draft GitHub Release targeting the exact merge commit.
5. Review the tag, target commit, title, release notes, compatibility, and
   migration guidance while it is still a draft.

A draft must not publish npm. Do not run `npm publish` locally as a fallback.

## 3. Publish through the protected workflow

1. Publish the approved GitHub Release.
2. Watch `Publish to NPM` through `validate-and-pack`.
3. Approve the `npm-production` deployment only after validation succeeds.
4. Let `publish-npm` publish the validated tarball through OIDC.
5. Do not rerun or bypass a failed gate until its cause is understood.

## 4. Verify the public release

The workflow performs bounded registry checks for version, `gitHead`, tarball
integrity, and Hawkeye's SLSA provenance. Maintainers should also confirm:

```bash
npm view oss-hawkeye-agent@X.Y.Z version gitHead dist.integrity --json
npm view oss-hawkeye-agent@X.Y.Z dist.attestations --json
npm audit signatures
```

Install from the registry in a clean temporary project with lifecycle scripts
disabled, then verify the CLI and MCP entrypoints. Record the GitHub Release,
workflow run, npm package, and provenance links in the release Issue.

## Failure and recovery

- **Before npm publish:** stop, preserve logs, fix through a reviewed PR, and
  rerun only when every gate can pass.
- **GitHub Release published but npm absent:** keep the tag and Release; fix the
  workflow rather than creating a second tag for the same version.
- **Version already exists on npm:** never try to overwrite it. npm does not
  allow reusing the same package name and version.
- **Bad package already published:** assess impact, deprecate only with explicit
  maintainer approval, and publish a reviewed patch version.
- **Missing provenance:** the existing version cannot be republished in place.
  Correct the pipeline and use a new version if provenance is required for the
  latest supported artifact.

Manual publication is an emergency exception, not a recovery shortcut. If one
occurs, document the publisher, command, time, `gitHead`, registry integrity,
and provenance status in both the release record and security documentation.
