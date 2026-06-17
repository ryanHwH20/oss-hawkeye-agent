# Security Policy

## Supported Versions

Currently, only the latest `main` branch and the latest released version are actively supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < 1.0.0 | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability within Hawkeye Agent, please send an e-mail to the maintainer at `ryanhsieh.ch@gmail.com` . 

All security vulnerabilities will be promptly addressed. We will:
1. Acknowledge receipt of your vulnerability report.
2. Provide an estimated timeframe for a fix.
3. Notify you when the vulnerability has been patched.

Thank you for helping keep the open-source ecosystem secure!

## Supply-Chain Integrity

Hawkeye is published to npm via **OIDC trusted publishing** from GitHub Actions — there is no long-lived npm token to leak. Each release carries **build provenance** (a signed [SLSA](https://slsa.dev) attestation linking the package back to the exact commit and workflow that built it).

Verify what you install:

```bash
# Verify the published package's provenance and signatures
npm audit signatures

# Or inspect a specific version's attestations
npm view oss-hawkeye-agent@latest dist.attestations
```

A passing `npm audit signatures` confirms the package on npm was built by this repository's `release.yml` workflow and has not been tampered with.
