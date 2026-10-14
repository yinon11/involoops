#!/usr/bin/env bash
# Deploy invoice_app to a remote host, rsync files, then rebuild/restart only the `app` service
# (Postgres, MinIO, etc. keep running).
#
# Usage (from your laptop, in this repo):
#   ./production_deploy.sh
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
# Optional environment overrides:
#   DEPLOY_HOST=my-deploy DEPLOY_USER=ubuntu DEPLOY_PATH=/home/ubuntu/invoices ./production_deploy.sh
#   (DEPLOY_HOST must be the SSH alias, not the bare domain, so the YubiKey config + master apply.)
#
# Notes:
# - Copies env to the server after rsync: prefers .env.server, else .env (both gitignored).
#   Skips if neither file exists (server keeps its current ~/invoices/.env).
# - Uses rsync --delete: files removed locally are removed on the server under the project path
#   (.env / .env.server are excluded from the bulk sync and pushed in a dedicated step).
# - Only touches the Compose project in DEPLOY_PATH; other Docker stacks on the host are unchanged.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:-loopitis-deploy}"   # SSH alias from ~/.ssh/config (not the bare domain)
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/ubuntu/invoices}"

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

echo "==> Deploying from: $ROOT"
echo "==> Target: ${REMOTE}:${DEPLOY_PATH}/"

# --- Provenance: rsync ships the working tree, not git ----------------------------------------
# A dirty or unpushed tree still deploys — the 2am hotfix is a feature — but loudly, and the
# stamp written to DEPLOY_PATH/DEPLOYED_SHA after the sync means "which code is live?" always
# has an answer on the server itself.
GIT_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY=""
[ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ] && GIT_DIRTY="-dirty"
GIT_UNPUSHED="$(git -C "$ROOT" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo '?')"
if [ -n "$GIT_DIRTY" ]; then
  echo "==> WARNING: the tree is DIRTY — uncommitted changes are going to production:" >&2
  git -C "$ROOT" status --short >&2
fi
if [ "$GIT_UNPUSHED" != "0" ] && [ "$GIT_UNPUSHED" != "?" ]; then
  echo "==> WARNING: deploying ${GIT_UNPUSHED} commit(s) that are not pushed to origin." >&2
fi
# The encrypted copies in git are the disaster-recovery source of truth. A
# deploy is the moment an .env edit becomes real, so it is also the moment the
# backup must refresh: re-encrypt (verified round-trip inside the script) and
# stage the result. Committing stays a human act — see what you record.
if [ -f "${ROOT}/server/env.production.enc.json" ] && [ "${ROOT}/.env" -nt "${ROOT}/server/env.production.enc.json" ]; then
  echo "==> .env is newer than its encrypted copy — re-encrypting..."
  "${ROOT}/scripts/encrypt-env.sh"
  git -C "${ROOT}" add server/env.production.enc.json server/env.sandbox.enc.json 2>/dev/null || true
  echo "==> Encrypted secrets refreshed and staged — commit when convenient." >&2
fi
# ----------------------------------------------------------------------------------------------

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

# Optional: fail fast if ssh does not work
ssh -o BatchMode=yes -o ConnectTimeout=15 "${REMOTE}" "test -d '${DEPLOY_PATH}'" || {
  echo "Error: remote path ${DEPLOY_PATH} does not exist or ssh failed." >&2
  exit 1
}

echo "==> Rsync project files..."
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
  --exclude='DEPLOYED_SHA' \
  "${ROOT}/" "${REMOTE}:${DEPLOY_PATH}/"

# Gitignored secrets: push to remote as .env (Compose reads ~/invoices/.env).
# Prefer .env.server (README production workflow), fall back to .env.
ENV_SRC=""
if [ -f "${ROOT}/.env.server" ]; then
  ENV_SRC="${ROOT}/.env.server"
  echo "==> Copying .env.server → ${DEPLOY_PATH}/.env on server..."
elif [ -f "${ROOT}/.env" ]; then
  ENV_SRC="${ROOT}/.env"
  echo "==> Copying .env → ${DEPLOY_PATH}/.env on server..."
fi
if [ -n "${ENV_SRC}" ]; then
  rsync -avz "${ENV_SRC}" "${REMOTE}:${DEPLOY_PATH}/.env"
  ssh -o BatchMode=yes "${REMOTE}" "chmod 600 '${DEPLOY_PATH}/.env'"
else
  echo "==> No .env.server or .env in project root; leaving remote ${DEPLOY_PATH}/.env unchanged."
fi

echo "==> Stamping DEPLOYED_SHA (${GIT_SHA}${GIT_DIRTY})..."
ssh -o BatchMode=yes "${REMOTE}" \
  "printf '%s\n' '${GIT_SHA}${GIT_DIRTY} $(date -u +%Y-%m-%dT%H:%M:%SZ) by $(whoami)@$(hostname)' > '${DEPLOY_PATH}/DEPLOYED_SHA'"

# --- Host crontab drift check (expected copy: server/host-crontab) ----------------------------
# The host crontab is the only hand-edited piece of the deployment, and that is exactly how
# scripts have ended up committed-but-never-scheduled. Deploy never installs it automatically
# (the ubuntu user's crontab is shared with other projects on the box); it only refuses to
# let drift stay invisible.
if [ -f "${ROOT}/server/host-crontab" ]; then
  if ! ssh -o BatchMode=yes "${REMOTE}" "crontab -l 2>/dev/null" \
      | diff -q - "${ROOT}/server/host-crontab" >/dev/null 2>&1; then
    echo "==> WARNING: host crontab on ${DEPLOY_HOST} differs from server/host-crontab:" >&2
    ssh -o BatchMode=yes "${REMOTE}" "crontab -l 2>/dev/null" \
      | diff -u --label "crontab -l (server)" --label "server/host-crontab (repo)" - "${ROOT}/server/host-crontab" >&2 || true
    echo "    If the repo copy is the intended one: ssh ${DEPLOY_HOST} 'crontab ${DEPLOY_PATH}/server/host-crontab'" >&2
  fi
fi
# ----------------------------------------------------------------------------------------------

# `cron` is listed explicitly: it depends on `app`, but compose only builds
# and starts the services named here, so leaving it out would deploy new code
# against a scheduler that never restarts — or, the first time, never starts.
echo "==> Rebuild and restart Compose services: app, cron (project: invoices)..."
ssh "${REMOTE}" "set -euo pipefail; cd '${DEPLOY_PATH}' && docker compose up -d --build app cron"

# Wait for the container to finish its boot sequence (mark-migrations-applied,
# drizzle-kit migrate, ensure-company-column, npm run start). The Dockerfile
# CMD runs with `set -e`, so a migration failure leaves the container in a
# crash loop instead of starting a half-migrated app — fail the deploy
# script in that case so the operator sees it and can inspect the logs,
# rather than walking away thinking the deploy succeeded.
APP_CONTAINER="invoices-app"
echo "==> Waiting for ${APP_CONTAINER} to become ready..."
READY=0
for i in $(seq 1 60); do
  LOGS=$(ssh -o BatchMode=yes "${REMOTE}" "docker logs --tail=300 ${APP_CONTAINER} 2>&1" || true)
  if echo "${LOGS}" | grep -q '✓ Ready in'; then
    READY=1
    break
  fi
  if echo "${LOGS}" | grep -Eq '^(Error:|error:)' && ! echo "${LOGS}" | grep -q 'Ready in'; then
    # Surface the most recent error and bail early instead of waiting the full timeout.
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

# Server-side builds leave cache behind; unbounded it once reached 197GB (pruned 2026-10-03)
# and was most of the disk. 20GB keeps recent layers for fast app rebuilds. The docker daemon
# is shared with the other stacks on the box, so their cache may be evicted too — it is only
# cache; they rebuild slower once. Never replace this with `docker image prune -a` here: it
# would delete stopped-container images and the irreplaceable cached minio/* tags.
echo "==> Trimming Docker build cache to 20GB..."
# (--reserved-space is the docker ≥29 name; --keep-storage the older one.)
ssh -o BatchMode=yes "${REMOTE}" "docker builder prune -f --reserved-space 20GB >/dev/null 2>&1 || docker builder prune -f --keep-storage 20GB >/dev/null 2>&1" || true

echo "==> Done. Compose services:"
ssh "${REMOTE}" "cd '${DEPLOY_PATH}' && docker compose ps"