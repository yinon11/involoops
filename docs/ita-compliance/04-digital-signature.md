# Spec 04 — Digital Signature (חשבונית ירוקה)

Archive copy. Canonical source is the conversation transcript.

## Summary

Every issued outbound document carries a cryptographic signature over its
canonical JSON representation. Draft documents are unsigned; issuing a
draft flips its status to `issued` and produces:

- A row in `document_signatures` (1:1 with `outbound_invoices`) that
  stores the canonical JSON, its SHA-256, the base64 signature, the
  `keyId`, the algorithm, and the signer.
- A `SIGNED` audit-log event inside the same transaction.

Public-key metadata lives in `signing_keys`. The private key is loaded
once per process into a cached `KeyObject` from `SIGNING_PRIVATE_KEY_FILE`
(production; a PEM file mounted read-only) or `SIGNING_PRIVATE_KEY_PEM`
(dev only). One software-house key per environment. Rotation inserts a
new ACTIVE row and sets the previous row to RETIRED. The retired public
key is not deleted or edited, so documents already signed with it keep
verifying. `REVOKED` rejects signatures: if `revoked_after` is set, only
signatures strictly after that instant fail; if it is null, every
signature from that key fails.

## Status enum

`draft → issued → sent | paid → voided`. Direct `draft → sent/paid` is
rejected — the document must be signed first. `cancelled` is renamed to
`voided` (data-only UPDATE; `status` is a TEXT column, not a pg_enum).

## Canonical document

`src/lib/signing/canonical-document.ts` exports `buildCanonicalDocument`
(pure, deterministic). Every amount is a 2-decimal string via
`formatMoney`. Dates are ISO-8601 UTC. Absent optional fields are omitted
rather than null. `schemaVersion = 1`.

## Verification

`verifyDocumentSignature(invoiceId)` performs two checks:

1. RSA-PSS-SHA256 check against the public key identified by `keyId`
   over the stored canonical JSON.
2. Rebuild canonical JSON from the LIVE invoice rows and compare its
   hash to the stored `canonicalJsonHash`. A mismatch means post-sign
   tampering (direct DB edit or similar).

Either failure returns `ok: false` with a specific reason.

## Public verify page

`/verify/[documentId]` is public (added to middleware allowlist). It
reveals only what the recipient already sees on their printed invoice:
formatted number, issuer legal name, customer name (if any), issue
date, grand total, currency, signed timestamp, key id.

## PDF additions

- Drafts: diagonal "DRAFT" / "טיוטה" watermark.
- Issued+ documents: signature footer with timestamp, key id, hash
  prefix, verify URL, and a QR code encoding the verify URL.

## Bootstrap

Run once after applying `drizzle/0025_digital_signatures.sql`:

```
npx tsx scripts/generate-dev-signing-key.ts --env dev
npx tsx scripts/generate-dev-signing-key.ts --env production \
  --private-key-out /etc/involoops/signing-private-key.pem
npx tsx scripts/generate-dev-signing-key.ts --env sandbox \
  --private-key-out /etc/involoops/signing-private-key-sandbox.pem
```

`--env` is required. `dev` mints `involoops-dev-…` and refuses a
non-local database. `production` mints `involoops-prod-…` with subject
`CN=InvoLoops, O=TTP GO LTD, C=IL`, writes the private key to the given
path, and does not print it. It refuses a database named
`invoices_sandbox`. Set `SIGNING_KEY_ID` and
`SIGNING_PRIVATE_KEY_FILE`. Do not put the production PEM in `.env`.
After a production key is minted, add its id to
`/etc/involoops/production-signing-key-ids`.

`sandbox` mints `involoops-sandbox-…` with subject
`CN=InvoLoops Sandbox, O=TTP GO LTD, C=IL` and writes a separate private
key file. It runs only against a database named `invoices_sandbox`.
Sandbox compose sets `SIGNING_ENVIRONMENT=sandbox` and mounts that file
plus the production key-id list. Boot exits if the configured id is in
that list, does not start with `involoops-sandbox-`, or the sandbox
database row is not the sandbox subject.

## Verification scripts

- `scripts/verify-numbering.ts` — 6/6
- `scripts/verify-audit.ts` — 5/5
- `scripts/verify-rbac.ts` — 7/7
- `scripts/verify-signing.ts` — 7/7 (canonical determinism, sign+verify,
  tamper, wrong key, not-signable, issue transition, immutability).
