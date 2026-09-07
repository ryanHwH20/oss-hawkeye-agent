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

Hawkeye's automated npm release workflow uses **OIDC trusted publishing** from
GitHub Actions, so the workflow does not require a long-lived npm publish token.
Releases successfully published through that workflow carry **build provenance**:
a signed [SLSA](https://slsa.dev) attestation linking the package to the source
commit and release workflow.

Version `1.4.0` is a documented exception. Its automated workflow stopped before
publishing because an unpinned npm upgrade became incompatible with the release
runner. The maintainer then published the already validated tarball manually.
Its registry integrity and `gitHead` match the reviewed release commit, but the
package does not carry a Hawkeye provenance attestation.

Verify what you install:

```bash
# Verify registry signatures and any attestations in the dependency tree
npm audit signatures

# Confirm Hawkeye itself has a provenance attestation
npm view oss-hawkeye-agent@latest dist.attestations
```

A passing `npm audit signatures` verifies registry signatures and available
attestations, but its aggregate count may include Hawkeye's dependencies. To
confirm that Hawkeye itself was published by the trusted workflow, the direct
`dist.attestations` query above must contain a SLSA provenance entry.
