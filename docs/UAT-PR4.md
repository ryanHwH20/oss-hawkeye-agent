# PR4 Maintainer UAT — `@oss-hawkeye` for VS Code

PR4 is accepted when a maintainer can invoke the exact `@oss-hawkeye`
participant, receive a canonical decision from the existing Runtime/Harness,
and inspect status or remediation without installing a dependency.

## 1. Run the headless seven-ecosystem UAT

```bash
npm run uat:pr4
```

The command builds the production chat bundle and invokes that compiled bundle
for NPM, PyPI, Cargo, Go, RubyGems, NuGet, and Maven. It performs live evidence
queries but never executes the assessed package-manager commands.

Confirm:

- every ecosystem has the expected coordinate;
- `replay` is `yes` for all rows;
- `action` is a canonical Harness action;
- a remediation row reports `fix: verified`;
- the final summary is `UAT PASSED`.

Verdicts are live observations and may change with upstream evidence. The UAT
checks the workflow and rendering rather than freezing a package verdict.

## 2. Build and inspect the VSIX

VSIX packaging uses the pinned official `@vscode/vsce` tool and requires Node
20 or newer. The main Hawkeye library retains its existing Node 18 runtime
support.

```bash
npm run package:vscode
unzip -l adapters/vscode/oss-hawkeye-vscode-0.1.0.vsix
```

Confirm the VSIX contains:

- `extension/dist/extension.js`;
- `extension/package.json`;
- `extension/README.md`;
- `extension/LICENSE`;
- `extension/policy.json`;
- `extension/icon.png`.

It must not contain TypeScript source, tests, source maps, environment files, or
credentials.

## 3. Install locally

Installation changes your local VS Code extensions. Run this step only when you
are ready to perform the UI UAT:

```bash
code --install-extension adapters/vscode/oss-hawkeye-vscode-0.1.0.vsix
```

Reload VS Code and open Chat. The participant list should contain:

```text
@oss-hawkeye
```

The slash-command picker should contain `/check`, `/scan`, `/explain`, `/fix`,
`/policy`, and `/status`.

## 4. Exercise the participant

Run:

```text
@oss-hawkeye /check npm install is-number@7.0.0
@oss-hawkeye /status
@oss-hawkeye /explain
@oss-hawkeye /policy
@oss-hawkeye /scan
```

Confirm `/check` reports a package coordinate, verdict, policy digest, and next
action. `/status` must show the same run and next action after a VS Code reload.
`/policy` must show `workspace` or `default`, not an absolute policy path.

Then exercise a live blocked/remediation case:

```text
@oss-hawkeye /check pip install idna==3.7
@oss-hawkeye /fix
```

Upstream evidence can change. If the package is still blocked with a verified
upgrade, confirm `/fix` displays that exact command and states that it has not
been executed. Otherwise use any current fixture that produces
`TRY_VERIFIED_REMEDIATION` from the headless UAT.

At no point should npm, pip, Cargo, Go, gem, dotnet, or Maven execute.

## 5. Ambiguity and fail-closed behavior

Run:

```text
@oss-hawkeye axios
```

Confirm Hawkeye asks for an explicit ecosystem/install command rather than
assuming NPM.

The response footer must state that chat guidance does not bypass PreToolUse or
shell enforcement. A provider/runtime failure must say that no approval was
issued.

## 6. Regression gates

```bash
npm run build
npm test
npm run build:vscode
npm run package:vscode
npm pack --dry-run
git diff --check
```

## Rollback / uninstall

```bash
code --uninstall-extension ryanhwh20.oss-hawkeye-vscode
```

Removing the chat extension does not remove or weaken separately configured
PreToolUse hooks or shell shims.

## UAT sign-off record

```text
UAT owner:
Date / timezone:
Commit SHA:
VS Code version:
Node / npm versions:
Headless seven-ecosystem UAT: PASS / FAIL
VSIX contents reviewed: YES / NO
@oss-hawkeye discovered: YES / NO
Six slash commands discovered: YES / NO
State survived reload: YES / NO
No package-manager command executed: YES / NO
Notes or screenshots:
```
