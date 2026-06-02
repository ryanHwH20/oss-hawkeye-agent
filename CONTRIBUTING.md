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

## Pull Request Process

1. Ensure any changes or new features have been discussed in an issue first.
2. Create a new branch from `main` (`git checkout -b feature/my-awesome-feature`).
3. Make your changes and ensure `npm run build` succeeds without TypeScript errors.
4. Update the `README.md` or `SKILL.md` with details of changes to the interface, if applicable.
5. Push your branch to GitHub and submit a Pull Request.

Once your PR is submitted, it will be reviewed by the maintainers. We may suggest some changes or improvements or alternative approaches.
