# Security policy

## Reporting a vulnerability

Please report security issues privately, **not** through a public issue.

- Email: **security@involoops.com**
- Or use GitHub's private vulnerability reporting on this repository
  (Security → Report a vulnerability).

Include, as far as you can:

- what you found and where (file, route, or endpoint);
- how to reproduce it;
- what an attacker could achieve with it.

We will acknowledge your report and keep you updated on the fix. Please give us
reasonable time to release a fix before disclosing publicly.

## What is in scope

This repository holds the application. Areas worth particular attention:

- **Tenant isolation.** Every query must be scoped to its user or business
  entity. A way to read or write another tenant's data is the most serious class
  of bug here.
- **File previews.** `/api/files/preview` refuses any object key not under
  `{userId}/`. Never relax that check.
- **Webhook verification.** Stripe signatures, Gmail Pub/Sub OIDC audience.
- **Cron routes.** `Authorization: Bearer <CRON_SECRET>`.
- **Document signing.** The canonical-JSON representation and signing keys under
  `src/lib/signing/`.
- **Encryption at rest.** SHAAM tokens, user API keys and MFA secrets are
  AES-256-GCM encrypted; key derivation lives beside each.

## Out of scope

- Findings that require a compromised operator machine or database.
- Missing hardening headers with no demonstrated impact.
- Reports produced solely by an automated scanner, with no working
  proof of concept.

## If you run your own instance

Each operator is responsible for their own deployment: secrets, network
exposure, database access, backups, and the legal obligations that come with
holding invoice data. See the README for what running this in production
requires. A vulnerability in *your* configuration is yours to fix; a
vulnerability in *this code* is ours — please report it.
