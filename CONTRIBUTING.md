# Contributing to Hawkeye Agent

First off, thank you for considering contributing to Hawkeye Agent! It's people like you that make Hawkeye Agent such a great tool for the open-source and DevSecOps community.

## Where do I go from here?

If you've noticed a bug or have a feature request, make sure to check our [Issues](https://github.com/ryanHwH20/oss-hawkeye-agent/issues) first to see if someone else has already created one. If not, go ahead and [make one](https://github.com/ryanHwH20/oss-hawkeye-agent/issues/new/choose)!

## Local Development

Hawkeye Agent is built with TypeScript and Node.js.

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (v9 or higher)

### Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/oss-hawkeye-agent.git
   cd oss-hawkeye-agent
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. You can test the CLI locally by running the built artifact:
   ```bash
   node dist/cli.js NPM express 5.2.1
   ```

## Testing Across Ecosystems

A passing npm example does not prove Hawkeye's broader product promise. Teams use
Hawkeye to make consistent dependency decisions across different stacks, so a
shared parser, policy, remediation, or enforcement change must not work for
JavaScript while silently changing the result for another ecosystem. In
particular, losing an explicit version can cause Hawkeye to assess the latest or
default release instead of the release the user intended to install.

Use this compatibility matrix when adding or reviewing tests:

| Language or runtime | Hawkeye ecosystem | Supported command families |
| --- | --- | --- |
| JavaScript / TypeScript | `NPM` | npm, pnpm, Yarn, Bun |
| Python | `PYPI` | pip, pip3 |
| Rust | `CARGO` | cargo |
| Go | `GO` | go |
| Ruby | `RUBYGEMS` | gem |
| .NET / C# | `NUGET` | dotnet |
| Java / Kotlin | `MAVEN` | Maven |

When a change affects shared command parsing, action assessment, remediation
rendering, source mapping, or enforcement detection, add table-driven tests for
all seven ecosystems. If behavior is genuinely ecosystem-specific, cover every
affected command family and explain the narrower scope in the pull request.

Before submitting a pull request, run:

```bash
npm run build
npm test
```

Command assessment supports the full matrix above. Project manifest scanning is
currently limited to npm and PyPI projects, so do not describe manifest scanning
as supporting all seven ecosystems until that capability is implemented and
tested.

## Pull Request Process

1. Ensure any changes or new features have been discussed in an issue first.
2. Create a new branch from `main` (`git checkout -b feature/my-awesome-feature`).
3. Make your changes and ensure both `npm run build` and `npm test` succeed.
4. Update the `README.md` or `SKILL.md` with details of changes to the interface, if applicable.
5. Add a maintainer UAT guide for user-visible or integration-facing behavior. It
   must explain the business outcome being accepted, the commands to run, the
   expected observations, and any live-data results that can legitimately vary.
6. Push your branch to GitHub and submit a Pull Request.

Once your PR is submitted, it will be reviewed by the maintainers. We may suggest some changes or improvements or alternative approaches.
