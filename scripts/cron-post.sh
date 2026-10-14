#!/usr/bin/env bash
# POST /api/cron/<route> — generic runner for the app's cron routes.
#
# Every route under src/app/api/cron/ takes the same Bearer CRON_SECRET, so
# they take the same script. Pass the route name as the only argument:
#
#   scripts/cron-post.sh shaam-retry-pending
#
# The app does NOT run any of these by itself — they have to be scheduled
# from the host. See docs/ita-compliance/KNOWN_ISSUES.md for the full
# crontab block.
#
# Env file loading matches scripts/cron-funnel-emails.sh (safe for quoted
# values).
#
# Overrides:
#   CRON_BASE_URL  — app base URL. Set to http://app:3000 inside compose so
#                    the call stays on the docker network; falls back to
#                    AUTH_URL / NEXTAUTH_URL from .env when unset (host use).
#   INVOICES_ROOT  — project root with .env (default: parent of scripts/)
#   CRON_ENV_FILE  — explicit path to .env
#   CRON_TIMEOUT   — seconds before curl gives up (default: 300)
#   CRON_LOCK_DIR  — where the per-route lock lives (default: /tmp/cron-post)

set -euo pipefail

ROUTE="${1:-}"
log() { printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "${ROUTE:-cron-post}" "$*" >&2; }

if [[ -z "$ROUTE" ]]; then
  log "ERROR: usage: $0 <cron-route-name>   e.g. $0 shaam-retry-pending"
  exit 2
fi
# The route becomes part of a URL; keep it to what a route segment can be.
if [[ ! "$ROUTE" =~ ^[a-z0-9-]+$ ]]; then
  log "ERROR: route must match [a-z0-9-]+ (got: $ROUTE)"
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INVOICES_ROOT="${INVOICES_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${CRON_ENV_FILE:-$INVOICES_ROOT/.env}"
TIMEOUT="${CRON_TIMEOUT:-300}"

# In compose the values arrive through `env_file:` / `environment:`, so a
# missing .env is only fatal when we still need something from it.
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -n "${CRON_SECRET:-}" && -n "${CRON_BASE_URL:-}" ]]; then
    ENV_FILE=""
  else
    log "ERROR: env file not found: $ENV_FILE (and CRON_SECRET/CRON_BASE_URL are not both set)"
    exit 1
  fi
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
done < <(if [[ -n "$ENV_FILE" ]]; then cat "$ENV_FILE"; fi)

# CRON_BASE_URL wins so the compose service can stay on the docker network
# (http://app:3000) while the host path keeps using the public AUTH_URL.
BASE_URL="${CRON_BASE_URL:-${AUTH_URL:-${NEXTAUTH_URL:-}}}"
BASE_URL="${BASE_URL%/}"

if [[ -z "${CRON_SECRET:-}" ]]; then
  log "ERROR: Set CRON_SECRET in $ENV_FILE (and restart the app so it matches)."
  exit 1
fi
if [[ -z "$BASE_URL" ]]; then
  log "ERROR: Set CRON_BASE_URL, or AUTH_URL/NEXTAUTH_URL in the env file."
  exit 1
fi

# One run per route at a time. `webhook-deliveries` and `extract-uploads`
# tick every minute and can take longer than that when draining a backlog;
# without this they pile up on each other. `mkdir` is atomic on POSIX, so
# this needs no flock and behaves the same on the host and in the image.
LOCK_DIR="${CRON_LOCK_DIR:-/tmp/cron-post}"
LOCK="$LOCK_DIR/$ROUTE.lock"
mkdir -p "$LOCK_DIR"
# Break a lock left behind by a killed run. Nothing can legitimately hold
# one for longer than the curl timeout, with slack for process startup.
STALE_AFTER=$(( TIMEOUT + 120 ))
if [[ -d "$LOCK" ]]; then
  lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || date +%s) ))
  if (( lock_age > STALE_AFTER )); then
    log "WARN: breaking stale lock ($lock_age s old, limit $STALE_AFTER s)"
    rmdir "$LOCK" 2>/dev/null || true
  fi
fi
if ! mkdir "$LOCK" 2>/dev/null; then
  log "SKIP: a previous run is still going"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

URL="${BASE_URL}/api/cron/${ROUTE}"
log "POST $URL"

# -f: curl fails on HTTP 4xx/5xx so a broken cron is visible in the log
# rather than quietly succeeding. --max-time stops a wedged run from
# overlapping the next tick.
tmp="$(mktemp)"
trap 'rm -f "$tmp"; rmdir "$LOCK" 2>/dev/null || true' EXIT
code="$(curl -sS -f -X POST "$URL" \
  --max-time "$TIMEOUT" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Accept: application/json" \
  -o "$tmp" \
  -w "%{http_code}")"
log "HTTP $code $(cat "$tmp")"
