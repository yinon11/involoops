#!/usr/bin/env bash
# Dump Postgres (Docker) → gzip → upload to S3-compatible storage (MinIO / AWS).
#
# Typical production (paths match docker-compose deploy):
#   INVOICES_ROOT=/home/ubuntu/invoices
#   Loads $INVOICES_ROOT/.env for S3_PUBLIC_ENDPOINT, MINIO_ROOT_*, etc.
#
# Env overrides (optional):
#   INVOICES_ROOT      — project dir with .env (default: dir above scripts/)
#   BACKUP_ENV_FILE    — explicit .env path
#   POSTGRES_CONTAINER — default: invoices-postgres
#   S3_BACKUP_BUCKET   — default: invoices (same bucket as app; isolated prefix)
#   S3_BACKUP_PREFIX   — default: db-backups (objects: s3://bucket/db-backups/invoices_<utc>.sql.gz)
#   S3_BACKUP_ENDPOINT — override API URL (default: S3_PUBLIC_ENDPOINT from .env)
#   BACKUP_RETAIN_COUNT — how many newest objects to keep under the prefix (default: 30)
#   KEEP_LOCAL_COPY    — if 1, leave the .sql.gz in backup_db/ after upload (default: 0)
#
# Requires: docker, aws CLI v2, bash 4+.
#
# Cron (daily, off-peak UTC example). Log under INVOICES_ROOT — NOT inside backup_db/:
# the shell opens the log file *before* the script runs, so the directory must
# already exist. Prefer:  >> $INVOICES_ROOT/backup-cron.log 2>&1
#   35 3 * * * INVOICES_ROOT=/home/ubuntu/invoices /home/ubuntu/invoices/scripts/backup-db-to-s3.sh >> /home/ubuntu/invoices/backup-cron.log 2>&1
#
# Frequency / retention (opinion):
#   Daily is enough for most invoice apps; add a second weekly run only if you change data hourly.
#   Keeping ~30 dailies gives roughly a month of point-in-time recovery without growing forever.

set -euo pipefail

log() { printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INVOICES_ROOT="${INVOICES_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${BACKUP_ENV_FILE:-$INVOICES_ROOT/.env}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-invoices-postgres}"
DB_USER="${POSTGRES_DB_USER:-invoices}"
DB_NAME="${POSTGRES_DB_NAME:-invoices}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-invoices}"
S3_BACKUP_PREFIX="${S3_BACKUP_PREFIX:-db-backups}"
BACKUP_RETAIN_COUNT="${BACKUP_RETAIN_COUNT:-30}"
KEEP_LOCAL_COPY="${KEEP_LOCAL_COPY:-0}"

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: env file not found: $ENV_FILE"
  exit 1
fi

# Load only the keys we need. A full `source .env` breaks on multiline or
# shell-special values; Docker / Next.js tolerate those.
load_kv_prefixes=(
  S3_PUBLIC_ENDPOINT
  S3_BACKUP_ENDPOINT
  MINIO_ROOT_USER
  MINIO_ROOT_PASSWORD
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION
  AWS_DEFAULT_REGION
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

ENDPOINT="${S3_BACKUP_ENDPOINT:-${S3_PUBLIC_ENDPOINT:-}}"
if [[ -z "$ENDPOINT" ]]; then
  log "ERROR: Set S3_PUBLIC_ENDPOINT in .env or S3_BACKUP_ENDPOINT in the environment."
  exit 1
fi

AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${MINIO_ROOT_USER:-}}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${MINIO_ROOT_PASSWORD:-}}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-us-east-1}}"

if [[ -z "$AWS_ACCESS_KEY_ID" || -z "$AWS_SECRET_ACCESS_KEY" ]]; then
  log "ERROR: Need AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or MINIO_ROOT_USER/MINIO_ROOT_PASSWORD in .env"
  exit 1
fi

EP=(--endpoint-url "$ENDPOINT")

mkdir -p "$INVOICES_ROOT/backup_db"
STAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
LOCAL_GZ="$INVOICES_ROOT/backup_db/invoices_${STAMP}.sql.gz"
S3_KEY="${S3_BACKUP_PREFIX}/invoices_${STAMP}.sql.gz"

log "Dumping $DB_NAME from container $POSTGRES_CONTAINER ..."
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" --no-owner --no-acl "$DB_NAME" \
  | gzip -9 > "$LOCAL_GZ"

log "Uploading s3://${S3_BACKUP_BUCKET}/${S3_KEY} ..."
aws s3 cp "$LOCAL_GZ" "s3://${S3_BACKUP_BUCKET}/${S3_KEY}" "${EP[@]}"

if [[ "$KEEP_LOCAL_COPY" != "1" ]]; then
  rm -f "$LOCAL_GZ"
  log "Removed local temp file."
else
  log "Kept local copy: $LOCAL_GZ"
fi

log "Pruning objects under s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/ (keep newest $BACKUP_RETAIN_COUNT) ..."
# Newest-first sort by key (UTC stamp in filename is lexicographically chronological).
mapfile -t ALL_KEYS < <(
  aws s3api list-objects-v2 \
    --bucket "$S3_BACKUP_BUCKET" \
    --prefix "${S3_BACKUP_PREFIX}/" \
    "${EP[@]}" \
    --query 'Contents[].Key' \
    --output text 2>/dev/null \
    | tr '\t' '\n' \
    | { grep -E '\.sql\.gz$' || true; } \
    | sort -r
)

count="${#ALL_KEYS[@]}"
if (( count > BACKUP_RETAIN_COUNT )); then
  for ((i = BACKUP_RETAIN_COUNT; i < count; i++)); do
    key="${ALL_KEYS[$i]}"
    log "Deleting old backup: s3://${S3_BACKUP_BUCKET}/${key}"
    aws s3 rm "s3://${S3_BACKUP_BUCKET}/${key}" "${EP[@]}"
  done
else
  log "No pruning ($count backup(s), retain $BACKUP_RETAIN_COUNT)."
fi

log "Done."
