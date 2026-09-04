# OSS Hawkeye for VS Code

Use `@oss-hawkeye` in VS Code Chat to assess explicit dependency-install
commands, inspect the current Harness workflow, explain a decision, display a
verified remediation, review policy, or scan supported workspace manifests.

```text
@oss-hawkeye /check npm install axios@1.7.2
@oss-hawkeye /status
@oss-hawkeye /explain
@oss-hawkeye /fix
@oss-hawkeye /policy
@oss-hawkeye /scan
```

The participant never executes a package-manager command. Chat guidance does
not replace Hawkeye's PreToolUse or shell enforcement.

Project manifest scanning currently covers NPM and PyPI manifests. Explicit
`/check` commands support NPM, PyPI, Cargo, Go, RubyGems, NuGet, and Maven.
