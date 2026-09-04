---
name: oss-hawkeye
description: Assess proposed open-source dependency installs with Hawkeye and continue its canonical safety workflow. Use for package adoption, install commands, package safety, verified remediation, current Hawkeye status, or dependency-policy questions.
---

# OSS Hawkeye

Use Hawkeye before acting on a proposed dependency install. Treat its structured
MCP response as the source of truth; do not infer, upgrade, or rewrite a verdict.

## Start an assessment

1. Obtain the exact package-manager command the user proposes. If the ecosystem,
   package, or requested version is ambiguous, ask for the command instead of
   assuming npm.
2. Call `hawkeye_check_action` with that command. This evaluates the action; it
   does not execute the package manager.
3. Report the returned `status`, package coordinates, decisive findings, policy
   reference, and `nextAction` in concise language.

Supported command families are npm, pip, Cargo, Go, RubyGems, NuGet, and Maven.

## Continue the workflow

- `SAFE`: present `EXECUTE_ALLOWED_ACTION` as the allowed action. Execution is a
  separate host action and remains subject to the host's normal enforcement.
- `BLOCKED`: follow the returned action exactly. Offer remediation only when it
  is `TRY_VERIFIED_REMEDIATION`; otherwise stop or request approval as directed.
- `UNKNOWN`: retry, stop, or request action exactly as directed. Never describe
  unknown or incomplete evidence as safe.
- `NOT_APPLICABLE`: say that Hawkeye did not assess the command. Do not convert
  it into an approval.

Use `hawkeye_next_action` with the returned state to inspect or resume a run.
Preserve the state exactly; do not edit its verdict, history, workspace, policy,
or pending action.

Call `hawkeye_submit_result` only after the host actually performs the exact
pending action, and submit the real outcome with the matching action ID.
Reporting a result is not approval to execute it.

## Safety boundaries

- Never offer a skip-audit or direct-install bypass.
- Never self-approve an exception or invent trusted-package status.
- Never substitute model judgment for missing, failed, or malformed evidence.
- If Hawkeye tools are unavailable, report that the action is unverifiable and
  do not label it safe. Suggest building the local adapter with
  `npm run build:mcp` and checking the host's MCP configuration.
- MCP guidance is advisory. Do not claim that it intercepts shell execution.
