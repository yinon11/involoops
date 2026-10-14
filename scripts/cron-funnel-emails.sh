#!/usr/bin/env bash
# POST /api/cron/funnel-emails — drain due funnel emails (SES).
#
# Set CRON_SECRET in .env (same value the Next.js app uses). Schedule from the
# host (cron / systemd timer / external scheduler); the app does not run this by itself.
#
# Env file loading matches scripts/backup-db-to-s3.sh (safe for quoted values).
#
# Typical crontab (daily — adjust time/path):
#   15 9 * * * INVOICES_ROOT=/home/ubuntu/invoices /home/ubuntu/invoices/scripts/cron-funnel-emails.sh >> /home/ubuntu/invoices/cron-funnel-emails.log 2>&1
#
# Overrides:
#   INVOICES_ROOT  — project root with .env (default: parent of scripts/)
#   CRON_ENV_FILE  — explicit path to .env

set -euo pipefail

log() { printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INVOICES_ROOT="${INVOICES_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${CRON_ENV_FILE:-$INVOICES_ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: env file not found: $ENV_FILE"
  exit 1
fi

load_kv_prefixes=(
  CRON_SECRET
  AUTH_URL
  NEXTAUTH_URL
)

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line//[[:space:]]/}" ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  val="${val%$'\r'}"
  [[ "$key" == "$line" ]] && continue
  for p in "${load_kv_prefixes[@]}"; do
    if [[ "$key" == "$p" ]]; then
      if [[ "$val" =~ ^\".*\"$ ]]; then val="${val#\"}"; val="${val%\"}"; fi
      if [[ "$val" =~ ^\'.*\'$ ]]; then val="${val#\'}"; val="${val%\'}"; fi
      export "${key}"="${val}"
      break
    fi
  done
done < "$ENV_FILE"

BASE_URL="${AUTH_URL:-${NEXTAUTH_URL:-}}"
BASE_URL="${BASE_URL%/}"

if [[ -z "$CRON_SECRET" ]]; then
  log "ERROR: Set CRON_SECRET in $ENV_FILE (and restart the app so it matches)."
  exit 1
fi
if [[ -z "$BASE_URL" ]]; then
  log "ERROR: Set AUTH_URL or NEXTAUTH_URL in $ENV_FILE to your public app URL."
  exit 1
fi

URL="${BASE_URL}/api/cron/funnel-emails"
log "POST $URL"

# -f: curl fails on HTTP 4xx/5xx so cron surfaces errors
tmp="$(mktemp)"
code="$(curl -sS -f -X POST "$URL" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Accept: application/json" \
  -o "$tmp" \
  -w "%{http_code}")"
body="$(cat "$tmp")"
rm -f "$tmp"
log "HTTP $code $body"
