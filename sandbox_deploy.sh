#!/usr/bin/env bash
# Deploy **only** the sandbox stack: rsync sources into ~/invoices_sandbox (by default),
# push `.env.sandbox` → remote `.env.sandbox`, then
# `docker compose --env-file .env.sandbox -f docker-compose.sandbox.yml up -d --build`.
#
# Does **not** run production (`~/invoices`, `docker-compose.yml` + `.env`). Project name on the
# host is `invoices_sandbox` (see `name:` in docker-compose.sandbox.yml).
#
# Usage (from your laptop, in this repo):
#   ./sandbox_deploy.sh
#
# Authentication:
# - Connects via an SSH alias (see ~/.ssh/config) that uses a hardware key
#   (id_ed25519_sk) and SSH connection multiplexing. The script opens a master connection
#   once (one passphrase + PIN + touch) and every ssh/rsync below reuses it.
# - REQUIRES this block in ~/.ssh/config:
#       Host my-deploy
#           HostName server.example.com
#           User ubuntu
#           IdentityFile ~/.ssh/id_ed25519_sk
#           IdentitiesOnly yes
#           IdentityAgent none
#           ControlMaster auto
#           ControlPath ~/.ssh/cm-%r@%h:%p
#           ControlPersist 10m
#
# Prerequisites:
#   - Local `.env.sandbox` (gitignored), from `.env.sandbox.example`. Copied to `${DEPLOY_PATH}/.env.sandbox` on the server.
#   - If missing locally: remote `.env.sandbox`, or bootstrap from remote `.env` / legacy `sandbox.env`.
#
# Optional overrides (DEPLOY_HOST must be the SSH alias, not the bare domain):
#   DEPLOY_HOST=my-deploy DEPLOY_USER=ubuntu DEPLOY_PATH=/home/ubuntu/invoices_sandbox ./sandbox_deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:-loopitis-deploy}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/ubuntu/invoices_sandbox}"
COMPOSE_SANDBOX="docker-compose.sandbox.yml"
SANDBOX_ENV=".env.sandbox"
COMPOSE="docker compose --env-file ${SANDBOX_ENV} -f ${COMPOSE_SANDBOX}"

# Production tree on the same host — never deploy sandbox script into this path.
PRODUCTION_DEPLOY_PATH="/home/ubuntu/invoices"

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

normalize_path() {
  echo "${1%/}"
}

DEPLOY_PATH="$(normalize_path "${DEPLOY_PATH}")"
PRODUCTION_DEPLOY_PATH="$(normalize_path "${PRODUCTION_DEPLOY_PATH}")"

if [ "${DEPLOY_PATH}" = "${PRODUCTION_DEPLOY_PATH}" ]; then
  echo "Error: sandbox_deploy.sh refuses DEPLOY_PATH=${DEPLOY_PATH} (that is the production app directory)." >&2
  echo "       Use production_deploy.sh for ~/invoices, or set DEPLOY_PATH to your sandbox tree (e.g. ${PRODUCTION_DEPLOY_PATH}_sandbox)." >&2
  exit 1
fi

echo "==> Sandbox-only deploy (Compose: ${COMPOSE_SANDBOX}, project: invoices_sandbox)"
echo "==> From: $ROOT"
echo "==> To:   ${REMOTE}:${DEPLOY_PATH}/"

# --- Ensure a multiplexed SSH master so the YubiKey is touched at most once -------------------
# A bare `ssh -O check` returns non-zero when no master exists; under `set -e` that would abort
# the script, so it must live inside an `if`. We open the master WITHOUT port-forwards
# (ClearAllForwardings) since the deploy doesn't need them and it avoids LocalForward collisions.
if ! ssh -O check "${REMOTE}" 2>/dev/null; then
  echo "==> Opening SSH master to ${REMOTE} — confirm on your YubiKey (passphrase + PIN + touch)..."
  ssh -fN -o ClearAllForwardings=yes "${REMOTE}"
fi
# Leave the SSH master running on exit — ControlPersist (~/.ssh/config) tears it down after the
# idle window, and keeping it up lets a back-to-back sandbox+production deploy reuse one touch.
# ---------------------------------------------------------------------------------------------

ssh -o BatchMode=yes -o ConnectTimeout=15 "${REMOTE}" "mkdir -p '${DEPLOY_PATH}'"

echo "==> Rsync project files (excludes local env secrets, node_modules, .git)..."
rsync -avz \
  --delete \
  --exclude='.env' \
  --exclude='.env.server' \
  --exclude='.env.local' \
  --exclude='.env.sandbox' \
  --exclude='.git' \
  --exclude='.git/' \
  --exclude='node_modules' \
  --exclude='node_modules/' \
  --exclude='.next' \
  --exclude='.next/' \
  --exclude='.turbo' \
  --exclude='.cursor' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  "${ROOT}/" "${REMOTE}:${DEPLOY_PATH}/"

if [ -f "${ROOT}/${SANDBOX_ENV}" ]; then
  # Same rule as production_deploy.sh: deploying an edited env means its
  # encrypted twin in git (server/env.sandbox.enc.json) must refresh too.
  # encrypt-env.sh re-encrypts both env files and verifies the round-trip.
  if [ -f "${ROOT}/server/env.sandbox.enc.json" ] && [ "${ROOT}/${SANDBOX_ENV}" -nt "${ROOT}/server/env.sandbox.enc.json" ]; then
    echo "==> ${SANDBOX_ENV} is newer than its encrypted copy — re-encrypting..."
    "${ROOT}/scripts/encrypt-env.sh"
    git -C "${ROOT}" add server/env.production.enc.json server/env.sandbox.enc.json 2>/dev/null || true
    echo "==> Encrypted secrets refreshed and staged — commit when convenient." >&2
  fi
  echo "==> Copying ${SANDBOX_ENV} → ${DEPLOY_PATH}/${SANDBOX_ENV} on server..."
  rsync -avz "${ROOT}/${SANDBOX_ENV}" "${REMOTE}:${DEPLOY_PATH}/${SANDBOX_ENV}"
  ssh -o BatchMode=yes "${REMOTE}" "chmod 600 '${DEPLOY_PATH}/${SANDBOX_ENV}'"
fi

echo "==> Ensuring ${DEPLOY_PATH}/${SANDBOX_ENV} exists on server..."
if ! ssh -o BatchMode=yes "${REMOTE}" "test -f '${DEPLOY_PATH}/${SANDBOX_ENV}'"; then
  if ssh -o BatchMode=yes "${REMOTE}" "test -f '${DEPLOY_PATH}/.env'"; then
    echo "==> Bootstrapping: remote .env → ${SANDBOX_ENV} (one-time)" >&2
    ssh -o BatchMode=yes "${REMOTE}" "set -euo pipefail; cd '${DEPLOY_PATH}' && cp .env '${SANDBOX_ENV}' && chmod 600 '${SANDBOX_ENV}'"
  elif ssh -o BatchMode=yes "${REMOTE}" "test -f '${DEPLOY_PATH}/sandbox.env'"; then
    echo "==> Migrating remote sandbox.env → ${SANDBOX_ENV} (one-time)" >&2
    ssh -o BatchMode=yes "${REMOTE}" "set -euo pipefail; cd '${DEPLOY_PATH}' && mv sandbox.env '${SANDBOX_ENV}' && chmod 600 '${SANDBOX_ENV}'"
  else
    echo "Error: missing ${SANDBOX_ENV} on ${REMOTE}:${DEPLOY_PATH} (and no .env / sandbox.env to migrate)." >&2
    echo "       Create ${ROOT}/${SANDBOX_ENV} from .env.sandbox.example, then re-run (see docs/deployment-sandbox.md)." >&2
    exit 1
  fi
fi

echo "==> ${COMPOSE} up -d --build (sandbox stack only)..."
ssh "${REMOTE}" "set -euo pipefail; cd '${DEPLOY_PATH}' && ${COMPOSE} up -d --build"

# Wait for the container to finish its boot sequence (mark-migrations-applied,
# drizzle-kit migrate, ensure-company-column, npm run start). The Dockerfile
# CMD enables errexit (set -e); a migration error leaves the container in a
# crash loop instead of starting a half-migrated app — fail the deploy
# script in that case so the operator sees it and can inspect the logs,
# rather than walking away thinking the deploy succeeded.
APP_CONTAINER="invoices-sandbox-app"
echo "==> Waiting for ${APP_CONTAINER} to become ready..."
READY=0
for i in $(seq 1 60); do
  LOGS=$(ssh -o BatchMode=yes "${REMOTE}" "docker logs --tail=300 ${APP_CONTAINER} 2>&1" || true)
  if echo "${LOGS}" | grep -q '✓ Ready in'; then
    READY=1
    break
  fi
  if echo "${LOGS}" | grep -Eq '^(Error:|error:)' && ! echo "${LOGS}" | grep -q 'Ready in'; then
    echo "==> Detected error in ${APP_CONTAINER} logs:" >&2
    echo "${LOGS}" | tail -30 >&2
    exit 1
  fi
  sleep 2
done
if [ "${READY}" -ne 1 ]; then
  echo "Error: ${APP_CONTAINER} did not become ready within 120s." >&2
  echo "       Inspect with: ssh ${REMOTE} 'docker logs --tail=200 ${APP_CONTAINER}'" >&2
  exit 1
fi
echo "==> ${APP_CONTAINER} is ready."

echo "==> Done. Sandbox services:"
ssh "${REMOTE}" "cd '${DEPLOY_PATH}' && ${COMPOSE} ps"