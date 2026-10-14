#!/usr/bin/env bash
# One-shot bootstrap for the PAdES-B PDF-signing keystore (dev).
#
# Produces a PKCS#12 keystore containing a self-signed RSA-2048 cert.
# Consumed by src/lib/signing/pdf-key-store.ts via:
#   INVOLOOPS_PDF_SIGNING_P12_PATH
#   INVOLOOPS_PDF_SIGNING_P12_PASSWORD
#   INVOLOOPS_PDF_SIGNING_ALIAS
#
# Usage:
#   export INVOLOOPS_PDF_SIGNING_P12_PASSWORD='<strong-passphrase>'
#   ./scripts/generate-dev-pdf-signing-keystore.sh [out-path]
#
# Defaults to ./pdf-signing-keystore-dev.p12 if no path given.
#
# Self-signed certs surface in Adobe as "signed but signer not trusted" —
# the signature itself is cryptographically valid. For production, swap
# this script's output with a Comsign-issued cert (same env vars).
#
# Key material is ISOLATED from the existing Spec 04 JSON-signing key
# (SIGNING_KEY_ID / SIGNING_PRIVATE_KEY_PEM). Different purpose, different
# rotation cadence, different cert requirements.
#
# NEVER commit the .p12 or the passphrase. .gitignore blocks *.p12.

set -euo pipefail

OUT_PATH="${1:-pdf-signing-keystore-dev.p12}"
ALIAS="${INVOLOOPS_PDF_SIGNING_ALIAS:-involoops-pdf-dev}"
SUBJECT="/CN=InvoLoops Development/O=TTP GO LTD/C=IL"
DAYS=3650

if [ -z "${INVOLOOPS_PDF_SIGNING_P12_PASSWORD:-}" ]; then
  echo "ERROR: INVOLOOPS_PDF_SIGNING_P12_PASSWORD must be set." >&2
  echo "       export INVOLOOPS_PDF_SIGNING_P12_PASSWORD='<strong-passphrase>' first." >&2
  exit 1
fi

if [ -e "$OUT_PATH" ]; then
  echo "ERROR: $OUT_PATH already exists. Refusing to overwrite." >&2
  echo "       Move or delete it first, then re-run." >&2
  exit 1
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

KEY="$TMPDIR/key.pem"
CRT="$TMPDIR/cert.pem"

openssl req -x509 -newkey rsa:2048 \
  -keyout "$KEY" -out "$CRT" \
  -days "$DAYS" -nodes \
  -subj "$SUBJECT"

openssl pkcs12 -export \
  -inkey "$KEY" -in "$CRT" \
  -name "$ALIAS" \
  -out "$OUT_PATH" \
  -password "pass:${INVOLOOPS_PDF_SIGNING_P12_PASSWORD}"

echo ""
echo "Wrote $OUT_PATH"
echo ""
echo "Next steps:"
echo "  1. Move $OUT_PATH to your deploy path (e.g. /etc/involoops/)."
echo "  2. Set in your env (dev .env / prod secret store):"
echo "       INVOLOOPS_PDF_SIGNING_P12_PATH=<absolute path to the .p12>"
echo "       INVOLOOPS_PDF_SIGNING_P12_PASSWORD=<the passphrase you used>"
echo "       INVOLOOPS_PDF_SIGNING_ALIAS=$ALIAS"
echo "  3. Never commit the .p12 or the passphrase."
echo "  4. Verify with: npx tsx scripts/verify-pdf-signing.ts"
