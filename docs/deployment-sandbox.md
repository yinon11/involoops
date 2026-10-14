# Sandbox deployment (`sandbox.involoops.com`)

The sandbox is a **second full stack** on the same host as production: its own Postgres, MinIO, volumes, and Docker Compose project. Production lives in `~/invoices`; sandbox in **`~/invoices_sandbox`**.

## Ports (host)

| Service    | Production | Sandbox   |
|-----------|------------|-----------|
| Next.js   | 3055       | **3056**  |
| MinIO S3  | 9105       | **9107**  |
| MinIO UI  | 127.0.0.1:9106 | 127.0.0.1:**9108** |
| pgAdmin   | 127.0.0.1:5051 | 127.0.0.1:**5052** |

Access pgAdmin only from the host (or an SSH tunnel): `http://127.0.0.1:5052`. **`PGADMIN_DEFAULT_EMAIL` must not use a `.local` domain** — current pgAdmin images reject it and the container will restart forever.

## One-time setup

1. **DNS (Cloudflare or registrar)**  
   Point **`sandbox.involoops.com`** at the server (same origin as production).  
   For browser uploads to MinIO, add **S3 API** and (optionally) **MinIO console** hostnames, e.g.:
   - `s3api-sandbox.involoops.com` → reverse proxy to `http://127.0.0.1:9107`
   - `s3-sandbox.involoops.com` → reverse proxy to `http://127.0.0.1:9108` (console)

2. **TLS reverse proxy** (nginx, Caddy, Traefik, etc.)  
   - App: `https://sandbox.involoops.com` → `http://127.0.0.1:3056`  
   - Match the pattern you use for production (`involoops.com` → 3055, `s3api.*` → 9105).

3. **Local env file** (laptop, not committed):

   ```bash
   cp .env.sandbox.example .env.sandbox
   ```

   Edit **`.env.sandbox`**:

   - `AUTH_URL` / `NEXTAUTH_URL`: `https://sandbox.involoops.com`
   - `S3_PUBLIC_ENDPOINT`: public URL of the **sandbox** MinIO API (e.g. `https://s3api-sandbox.involoops.com`)
   - `MINIO_SERVER_URL`: same as `S3_PUBLIC_ENDPOINT` (API URL)
   - `MINIO_BROWSER_REDIRECT_URL`: MinIO console URL (e.g. `https://s3-sandbox.involoops.com`)
   - Strong `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`
   - **OAuth**: add `https://sandbox.involoops.com/api/auth/callback/google` (and any other providers) in the provider console
   - **Gmail / Pub/Sub**: prefer leaving disabled in sandbox, or use a separate topic and `GMAIL_PUBSUB_AUDIENCE` matching the sandbox webhook URL
   - **Stripe**: use test keys and a dedicated webhook endpoint for the sandbox URL if you test billing

4. **Object Lock archive (Spec 05)**  
   `minio-init` creates **`invoices-archive-sandbox`** with **`mc mb --with-lock`** and enables versioning. On app startup, **`scripts/ensure-archive-bucket-lock.mjs`** applies the default **Rule** via the AWS SDK (same library as issuance).  
   Optional: run `npx tsx scripts/setup-archive-bucket.ts` from your machine if you manage MinIO outside Compose.

## Deploy / update

From the repo root on your machine:

```bash
chmod +x sandbox_deploy.sh   # once
./sandbox_deploy.sh
```

This **only** touches the sandbox tree (default **`~/invoices_sandbox`**) and **`docker-compose.sandbox.yml`**. It refuses **`DEPLOY_PATH=/home/ubuntu/invoices`** so you cannot accidentally overwrite production with this script.

It rsyncs code, copies **`.env.sandbox`** → remote **`.env.sandbox`**, and runs:

`docker compose --env-file .env.sandbox -f docker-compose.sandbox.yml up -d --build` (full sandbox stack).

## Useful commands (on the server)

```bash
cd ~/invoices_sandbox
docker compose --env-file .env.sandbox -f docker-compose.sandbox.yml ps
docker compose --env-file .env.sandbox -f docker-compose.sandbox.yml logs app --tail 100
```

## Differences from production `docker-compose.yml`

- Compose **project name** `invoices_sandbox` (separate networks/volumes).
- DB user/db: **`invoices_sandbox`** / database **`invoices_sandbox`**.
- S3 buckets: **`invoices-sandbox`**, **`invoices-archive-sandbox`** (created by `minio-init`).

Production (`~/invoices`) uses **`docker-compose.yml`** and **`~/invoices/.env`** on the host for that stack (see `production_deploy.sh`). Sandbox uses **`.env.sandbox`** only under **`~/invoices_sandbox`**.

## Troubleshooting

### Invoice file previews show "stored under an unexpected path"

**Short version: expected in sandbox, and not a bug. Do not "fix" it with an
`UPDATE`.** Investigated 2026-09-16; production was clean.

`/api/files/preview` looks the invoice up by `(id, user_id)`, then refuses to
stream the object unless its storage key starts with `{user_id}/` — the scheme
`buildFileKey` produces. Sandbox databases seeded from a production copy carry
rows whose `user_id` no longer matches the id their files were stored under, so
every historical row fails that check and the reader sees:

> This file is stored under an unexpected path, so it cannot be shown. Please
> report invoice `<id>`

The server log carries the detail:

```
[preview] key prefix mismatch for invoice <id>: expected "<uuid>/", key starts "<other-uuid>/..."
```

**The second half matters more than the first.** Sandbox runs its own MinIO
(`s3api-sandbox.involoops.com`, own credentials, own buckets — see *Differences
from production* above). A database copy does not bring the objects with it, so
those files are very likely **not in sandbox at all**. Rewriting `file_url` would
produce a valid-looking path with nothing behind it, and `file_url` is the only
record of where each object lives — on production that rewrite would orphan the
files irreversibly. Leave it: a failed preview is a truthful signal that sandbox
does not hold that file.

#### Before assuming it is the seeding artifact, confirm it

1. **Is the key's prefix a real, separate account?** Two rows back and this is a
   data-integrity incident, not a sandbox quirk — stop and investigate.

   ```sql
   SELECT id, email, created_at FROM users
   WHERE id IN ('<row user_id>', '<prefix from the log>');
   ```

2. **Does production have the same skew?** This is the question that decides
   whether anything needs fixing at all. Run it **on production**:

   ```sql
   SELECT
     CASE
       WHEN file_url LIKE 'http%'         THEN 'full URL'
       WHEN file_url LIKE user_id || '/%' THEN 'ok: user-prefixed key'
       ELSE 'MISMATCH'
     END AS shape,
     count(*)
   FROM invoices
   WHERE file_url IS NOT NULL
   GROUP BY 1;
   ```

   | Production result | Meaning | Action |
   |---|---|---|
   | 0 mismatches | Sandbox-only artifact | None. Leave both alone. |
   | mismatches > 0 | Real users affected | Go to step 3 before touching anything. |

3. **Where do the objects actually sit?** Never guess — `file_url` is the sole
   pointer. Read-only, HEAD requests only, run in the environment you are asking
   about:

   ```bash
   docker compose exec app npx tsx scripts/check-invoice-file-locations.ts
   ```

   It reports `error` rather than `missing` when the bucket is unreachable, so an
   S3 outage is never mistaken for an absent object. `only at stored (old)
   prefix` means fix it in code (record the legacy prefix for that account) and
   change no data.

**Do not relax the prefix check as a shortcut.** It cannot distinguish "my own
previous account id" from "somebody else's account", so loosening it to clear a
sandbox annoyance would open a cross-account file read on production.

### `Bucket is missing ObjectLockConfiguration` when issuing an invoice

**Bootstrap:** On container start, **`scripts/ensure-archive-bucket-lock.mjs`** runs (before DB migrations) and calls **`PutObjectLockConfiguration`** with the same **`@aws-sdk/client-s3`** as the app. `mc mb --with-lock` alone often leaves the bucket without a **Rule**; the SDK then rejects COMPLIANCE uploads until that runs.

**If the app container exits on boot** with `ensure-archive-bucket-lock: failed` and **`InvalidBucketState`**, the archive bucket was created without object lock. Set **`SANDBOX_RECYCLE_ARCHIVE_BUCKET=1`** in `.env.sandbox` for **one** deploy so `minio-init` removes and recreates the archive bucket with `--with-lock`, then remove that line and redeploy.

**Manual recycle** (sandbox only; drop test data you can afford to lose):

```bash
cd ~/invoices_sandbox
docker compose --env-file .env.sandbox -f docker-compose.sandbox.yml run --rm --entrypoint /bin/sh minio-init -c '
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
  mc rb --force local/invoices-archive-sandbox
'
docker compose --env-file .env.sandbox -f docker-compose.sandbox.yml up -d --force-recreate minio-init app
```

Ensure **`S3_ARCHIVE_BUCKET`** in `.env.sandbox` matches the archive bucket name (Compose also sets this on the `app` service from the same default as `minio-init`).

Then optionally run `npx tsx scripts/setup-archive-bucket.ts` with sandbox `S3_*` / `S3_ARCHIVE_BUCKET` (and `S3_INTERNAL_ENDPOINT=http://127.0.0.1:9107` if you tunnel the API port).

## Docker startup order

The image runs **`ensure-archive-bucket-lock.mjs`**, then **`drizzle-kit push`**, then **`ensure-company-column.mjs`**, then **`npm run start`**. The company-name script assumes `users` exists after Drizzle.
