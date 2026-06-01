# Contributing to Hawkeye Agent

First off, thank you for considering contributing to **Hawkeye Agent**! It's people like you that make Hawkeye an indisputable standard for open-source supply chain security.

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

- **Check open issues** before submitting a new report to avoid duplicates.
- Use the **Bug Report** template when opening an issue.
- Provide as much detail as possible (e.g., node version, OS, exact command run, and any error traces).

### Suggesting Enhancements

We welcome new features, integrations with other ecosystems (Cargo, Go, Maven), and general improvements.

- Use the **Feature Request** template.
- Explain the current behavior and why the proposed behavior would be an improvement.
- If suggesting a new feature, provide a real-world use case.

### Pull Requests

1. **Fork** the repo on GitHub.
2. **Clone** the project to your own machine.
3. **Commit** changes to your own branch.
4. **Push** your work back up to your fork.
5. Submit a **Pull Request** so that we can review your changes.

NOTE: Be sure to merge the latest from "upstream" before making a pull request!

## Development Setup

To set up your local development environment:

1. Clone your fork:
   ```bash
   git clone https://github.com/ryanHwH20/hawkeye-agent.git
   cd hawkeye-agent
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile TypeScript:
   ```bash
   npm run build
   ```
4. Test locally using the binary:
   ```bash
   npm link
   hawkeye NPM express 4.16.0
   ```

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/). This helps us automatically generate changelogs.

Format:
`<type>[optional scope]: <description>`

Examples:
- `feat(cli): add support for rust cargo`
- `fix(formatter): correct markdown table alignment`
- `docs(readme): update mcp server instructions`

Common Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries

Thank you for contributing! 🎾
