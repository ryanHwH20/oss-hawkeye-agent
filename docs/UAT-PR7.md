# PR7 Maintainer UAT — installed npm artifact

PR7 is accepted when the npm tarball contains the complete Agent-Native runtime
and a clean consumer can use the installed CLI and MCP entrypoints. Repository
source files must not mask missing package contents.

The optional MCP adapter and this UAT require Node.js 20 or newer. The main CLI
and library retain their Node.js 18 support.

## Why this UAT exists

The retired `hooks/claude-code-precheck.mjs` was not included in the published
`1.3.0` tarball. PR #100 replaced it with `adapters/claude-code.mjs` and added
`adapters/` to the npm allowlist. This UAT verifies the replacement and all
newer Agent-Native entrypoints from the artifact users will actually install.

## 1. Check the tarball contract

```bash
npm run build
npm run build:mcp
npm run check:package
```

The check runs `npm pack --json --dry-run --ignore-scripts` and fails if any of
these product surfaces are absent:

- the `hawkeye` CLI and public library;
- `adapters/claude-code.mjs` and its shared gate;
- the `hawkeye-mcp` launcher and compiled MCP bundle;
- the canonical `oss-hawkeye` Skill;
- policy, architecture, integration, and current UAT documentation.

## 2. Run the clean-install seven-ecosystem UAT

```bash
npm run uat:pr7
```

The script creates a temporary consumer, packs the current repository, and
installs that local tarball with npm lifecycle scripts disabled. It then:

1. validates both declared binary entrypoints;
2. loads the installed CLI and checks its usage contract;
3. launches MCP from `node_modules/oss-hawkeye-agent`;
4. discovers exactly the three canonical Hawkeye tools;
5. assesses NPM, PyPI, Cargo, Go, RubyGems, NuGet, and Maven;
6. JSON-round-trips state and confirms deterministic replay;
7. removes the temporary consumer.

The setup step runs npm only to install the locally built Hawkeye tarball. None
of the seven package-manager commands submitted to Hawkeye are executed.

Confirm every row contains the expected coordinate, `installed` is `yes`,
`deterministic` is `yes`, and the final result is `UAT PASSED`. Live evidence
may produce `SAFE`, `BLOCKED`, or `UNKNOWN`; the artifact, protocol, coordinate,
state, and fail-closed behavior are the acceptance criteria.

## 3. Dependency advisory check

```bash
npm audit
npm ls postcss nanoid --all
```

Confirm npm reports zero known vulnerabilities and the resolved versions are at
least `postcss@8.5.23` and `nanoid@3.3.18`, which are outside the advisory
ranges recorded when this PR was prepared.

## 4. Regression gates

```bash
npm run check:skills
npm test
npm run check:setup
npm run check:smoke
git diff --check
```

## UAT sign-off record

```text
UAT owner:
Date / timezone:
Commit SHA:
Node / npm versions:
Package contract: PASS / FAIL
Clean tarball installation: PASS / FAIL
Installed CLI entrypoint: PASS / FAIL
Installed MCP entrypoint: PASS / FAIL
Seven-ecosystem UAT: PASS / FAIL
State replay deterministic: YES / NO
No assessed package-manager command executed: YES / NO
npm audit vulnerabilities: 0 / other
Notes:
```
