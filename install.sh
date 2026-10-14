#!/usr/bin/env bash
# =============================================================================
# InvoLoops — one-command self-host install.
#
#   git clone <repo> && cd <repo> && ./install.sh
#
# Asks for two things (app URL and the first admin account); everything else
# — database passwords (owner + restricted runtime role), auth and encryption
# secrets, MinIO credentials, the document-signing RSA key, the PDF-signing
# keystore — is GENERATED, unique to this installation, and written to `.env`
# (chmod 600) and `local-secrets/`. Nothing ships with a default password.
#
# Integrations stay OFF until configured in `.env` later: outbound email
# (SES), Stripe billing, Gmail intake, AI extraction (users can bring their
# own Anthropic key in Settings), and SHAAM/ITA allocation. The ITA one is
# deliberate: issuing legal Israeli tax invoices with allocation numbers
# requires the operator's own software registration with the Tax Authority —
# this installer will not wire a stranger into ours.
#
# Non-interactive use (CI / rehearsal):
#   INSTALL_APP_URL=http://localhost:3055 INSTALL_ADMIN_EMAIL=a@b.c \
#   INSTALL_ADMIN_PASSWORD='...' ./install.sh
#
# The result listens on 127.0.0.1:3055. For anything beyond localhost, put a
# TLS reverse proxy in front and re-run with your https URL — this script is
# a quickstart, not a production hardening guide.
# =============================================================================

set -euo pipefail

log()  { printf '\n==> %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------- Guards -----------------------------------------------------------

[[ -f .env ]] && die ".env already exists — this looks like an installed instance. Remove .env (and 'docker compose down -v' if you mean to start over) before re-running."
# Compose prefixes volume keys with the project name (default "invoices"),
# so the postgres volume is usually invoices_invoices_pgdata. A stale volume
# means postgres keeps its OLD password and ignores the generated one —
# the install fails later with "password authentication failed".
PROJ="${COMPOSE_PROJECT_NAME:-invoices}"
for v in "${PROJ}_invoices_pgdata" invoices_pgdata; do
  docker volume inspect "$v" >/dev/null 2>&1 \
    && die "Docker volume $v already exists — there is InvoLoops data (or an old dev leftover) on this machine. 'docker compose down -v' first if you really mean to start fresh."
done

# ---------- Preflight --------------------------------------------------------

MISSING=()
for t in docker openssl curl; do command -v "$t" >/dev/null 2>&1 || MISSING+=("$t"); done
docker compose version >/dev/null 2>&1 || MISSING+=("docker-compose-plugin")
[[ ${#MISSING[@]} -gt 0 ]] && die "missing tools: ${MISSING[*]}"
docker info >/dev/null 2>&1 || die "docker daemon not reachable (is it running? are you in the docker group?)"

# ---------- The two questions ------------------------------------------------

APP_URL="${INSTALL_APP_URL:-}"
if [[ -z "$APP_URL" ]]; then
  read -r -p "App URL [http://localhost:3055]: " APP_URL
  APP_URL="${APP_URL:-http://localhost:3055}"
fi
[[ "$APP_URL" =~ ^https?:// ]] || die "APP_URL must start with http:// or https://"
APP_URL="${APP_URL%/}"

ADMIN_EMAIL="${INSTALL_ADMIN_EMAIL:-}"
[[ -z "$ADMIN_EMAIL" ]] && read -r -p "Admin email: " ADMIN_EMAIL
[[ "$ADMIN_EMAIL" == *@* ]] || die "that is not an email address"

ADMIN_PASSWORD="${INSTALL_ADMIN_PASSWORD:-}"
if [[ -z "$ADMIN_PASSWORD" ]]; then
  read -r -s -p "Admin password (min 8 chars): " ADMIN_PASSWORD; echo
fi
[[ ${#ADMIN_PASSWORD} -ge 8 ]] || die "password too short"

# ---------- Generate every secret -------------------------------------------

log "Generating installation-unique secrets"
gen() { openssl rand -hex "$1"; }
POSTGRES_PASSWORD="$(gen 24)"
POSTGRES_APP_PASSWORD="$(gen 24)"
AUTH_SECRET="$(gen 32)"
MINIO_ROOT_USER="involoops"
MINIO_ROOT_PASSWORD="$(gen 24)"
CRON_SECRET="$(gen 24)"
API_KEY_PEPPER="$(gen 32)"
USER_API_KEY_ENCRYPTION_SECRET="$(gen 32)"
SHAAM_TOKEN_ENCRYPTION_SECRET="$(gen 32)"
PDF_P12_PASSWORD="$(gen 24)"

# ---------- Local key material ----------------------------------------------

log "Generating the PDF-signing keystore (self-signed; see the note at the end)"
mkdir -p local-secrets
INVOLOOPS_PDF_SIGNING_P12_PASSWORD="$PDF_P12_PASSWORD" \
  ./scripts/generate-dev-pdf-signing-keystore.sh local-secrets/pdf-signing-keystore.p12 >/dev/null
# The document-signing key is generated INSIDE the container later (it also
# registers itself in the database); the file must pre-exist for the bind mount.
install -m 600 /dev/null local-secrets/signing-private-key.pem

log "Writing docker-compose.override.yml (repo-local secret paths instead of /etc/involoops)"
cat > docker-compose.override.yml <<'EOF'
# Written by install.sh — maps the container's expected key paths to the
# repo-local local-secrets/ directory, so no root-owned /etc/involoops is
# needed. The signing key is :rw because scripts/generate-dev-signing-key.ts
# writes it from inside the container on first install (and on rotation).
services:
  app:
    volumes:
      - ./local-secrets/signing-private-key.pem:/etc/involoops/signing-private-key.pem:rw
      - ./local-secrets/pdf-signing-keystore.p12:/etc/involoops/pdf-signing-keystore-prod.p12:ro
EOF

# ---------- .env -------------------------------------------------------------

log "Writing .env (chmod 600)"
umask 077
cat > .env <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%d) — every value below is
# unique to this installation. Back this file up together with local-secrets/.
# Reference for every available option: .env.example

# --- URLs -------------------------------------------------------------------
AUTH_URL=${APP_URL}
NEXTAUTH_URL=${APP_URL}
NEXT_PUBLIC_APP_URL=${APP_URL}
# Browser-reachable MinIO endpoints (presigned uploads / previews / console).
# Defaults assume localhost; with a public domain, reverse-proxy MinIO and
# update these (see the note install.sh prints at the end).
S3_PUBLIC_ENDPOINT=http://localhost:9105
MINIO_SERVER_URL=http://localhost:9105
MINIO_BROWSER_REDIRECT_URL=http://localhost:9106

# --- Generated credentials ---------------------------------------------------
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_APP_PASSWORD=${POSTGRES_APP_PASSWORD}
AUTH_SECRET=${AUTH_SECRET}
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
CRON_SECRET=${CRON_SECRET}
API_KEY_PEPPER=${API_KEY_PEPPER}
USER_API_KEY_ENCRYPTION_SECRET=${USER_API_KEY_ENCRYPTION_SECRET}
SHAAM_TOKEN_ENCRYPTION_SECRET=${SHAAM_TOKEN_ENCRYPTION_SECRET}

# --- Document signing --------------------------------------------------------
# SIGNING_KEY_ID is appended by install.sh after the key registers itself.
SIGNING_PRIVATE_KEY_FILE=/etc/involoops/signing-private-key.pem
INVOLOOPS_PDF_SIGNING_P12_PATH=/etc/involoops/pdf-signing-keystore-prod.p12
INVOLOOPS_PDF_SIGNING_P12_PASSWORD=${PDF_P12_PASSWORD}

# --- Deliberately off (configure later, then: docker compose up -d app cron) --
# Outbound email:   SES_* (see .env.example) — password resets, invoices by mail
# Billing:          STRIPE_*
# Gmail intake:     GMAIL_*
# AI extraction:    ANTHROPIC_API_KEY (or users bring their own key in Settings)
# SHAAM allocation: SHAAM_* — requires YOUR OWN Israel Tax Authority software
#                   registration (Form 513). Do not point at another operator's.
EMAIL_FUNNELS_ENABLED=false
DEFAULT_DISPLAY_CURRENCY=ILS
EOF

# ---------- Infrastructure up ------------------------------------------------

log "Starting postgres, minio, redis"
docker compose up -d postgres minio redis
for _ in $(seq 1 30); do
  docker exec invoices-postgres pg_isready -U invoices >/dev/null 2>&1 && break; sleep 2
done
docker exec invoices-postgres pg_isready -U invoices >/dev/null 2>&1 || die "postgres did not become ready"
for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9105/minio/health/live >/dev/null 2>&1 && break; sleep 2
done
curl -sf http://127.0.0.1:9105/minio/health/live >/dev/null || die "minio did not become healthy"

log "Creating buckets (minio-init)"
docker compose up -d minio-init
[[ "$(docker wait invoices-minio-init)" == "0" ]] || die "minio-init failed — docker logs invoices-minio-init"

log "Creating the restricted runtime DB role (audit log becomes INSERT-only)"
{ printf "\\\\set app_password '%s'\n" "$POSTGRES_APP_PASSWORD"; cat scripts/sql/create-app-role.sql; } \
  | docker exec -i invoices-postgres psql -q -U invoices -d invoices \
      -v app_role=invoices_app -v owner_role=invoices -f - >/dev/null

# ---------- Build and start the app -----------------------------------------

log "Building the app image — this is the long part (5–15 minutes, one time)"
docker compose up -d --build app cron

log "Waiting for first boot (migrations run now)"
READY=0
for _ in $(seq 1 120); do
  docker logs --tail=200 invoices-app 2>&1 | grep -q '✓ Ready in' && { READY=1; break; }
  sleep 3
done
[[ "$READY" == "1" ]] || die "app did not become ready — docker logs invoices-app"

# ---------- In-container finishing steps -------------------------------------

log "Applying the audit-log hardening (the table exists now that migrations ran)"
{ printf "\\\\set app_password '%s'\n" "$POSTGRES_APP_PASSWORD"; cat scripts/sql/create-app-role.sql; } \
  | docker exec -i invoices-postgres psql -q -U invoices -d invoices \
      -v app_role=invoices_app -v owner_role=invoices -f - | tail -3

log "Seeding pricing tiers"
docker exec invoices-app npx tsx scripts/seed-pricing-tiers.ts >/dev/null

log "Generating + registering the document-signing key"
# The generator refuses to overwrite an existing file, and the bind-mounted
# placeholder must pre-exist (else docker turns the mount into a directory).
# So: generate to a container temp path, then write the content INTO the
# mounted file (same inode) and remove the temp copy.
KEY_OUT="$(docker exec invoices-app sh -c 'npx tsx scripts/generate-dev-signing-key.ts \
  --env production --private-key-out /tmp/signing-key-new.pem \
  && cat /tmp/signing-key-new.pem > /etc/involoops/signing-private-key.pem \
  && rm -f /tmp/signing-key-new.pem' 2>&1)" \
  || { echo "$KEY_OUT" >&2; die "signing key generation failed"; }
SIGNING_KEY_ID="$(printf '%s\n' "$KEY_OUT" | grep -oE 'SIGNING_KEY_ID="[^"]+"' | head -1 | cut -d'"' -f2)"
[[ -n "$SIGNING_KEY_ID" ]] || { echo "$KEY_OUT" >&2; die "could not parse SIGNING_KEY_ID from generator output"; }
printf 'SIGNING_KEY_ID="%s"\n' "$SIGNING_KEY_ID" >> .env

log "Restarting the app with the signing key"
docker compose up -d app
for _ in $(seq 1 40); do
  docker logs --tail=50 invoices-app 2>&1 | grep -q '✓ Ready in' && break; sleep 3
done

log "Creating your admin account"
docker exec \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  invoices-app npx tsx scripts/create-admin.ts

# ---------- Done -------------------------------------------------------------

cat <<EOF

=================================================================
 InvoLoops is running.

   URL:    ${APP_URL}
   Login:  ${ADMIN_EMAIL}  (the password you chose)

 Enabled now: invoicing (inbound + outbound), PDF generation and
 signing, file storage, scheduled jobs, REST API.

 Off until you configure them in .env (then: docker compose up -d app cron):
   outbound email (SES_*) · Stripe billing · Gmail intake ·
   AI extraction (ANTHROPIC_API_KEY, or per-user keys in Settings) ·
   SHAAM/ITA allocation — needs YOUR OWN Tax Authority registration.

 Keep safe (they ARE this installation): .env + local-secrets/
 Backups: keep those two, and dump the database plus the file-storage volume.

 Not localhost? Put a TLS reverse proxy in front (proxy_pass to
 127.0.0.1:3055), use an https:// URL, and reverse-proxy MinIO
 (S3_PUBLIC_ENDPOINT / MINIO_* URLs in .env) for uploads/previews.
 PDF signatures use a self-signed certificate — valid, but PDF
 readers show "signer not trusted" until you install a CA-issued
 one (same env vars, see scripts/generate-dev-pdf-signing-keystore.sh).
=================================================================
EOF
