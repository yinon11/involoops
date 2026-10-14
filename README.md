# General invoice application — product plan

This document describes **what** a new invoice system should do and **how** it should behave. It is intentionally **technology-agnostic**: no programming languages, vendors, or concrete storage products are specified. You may assume a **database** (or equivalent durable store) plus **file storage** for original documents wherever persistence is implied.

> **Want to run it, not read about it?** → [Installation](#installation) · [Product spec](#1-purpose) · [REST API](docs/api/00-overview.md)

---

## Installation

One command, two questions, one coffee:

```bash
git clone <repository-url> involoops
cd involoops
./install.sh
```

The installer asks for your **app URL** (default `http://localhost:3055`) and an **admin email + password**. Every other credential — database passwords (including a restricted runtime role that makes the audit log append-only), auth and encryption secrets, storage keys, document-signing keys — is **generated uniquely for your installation**. Nothing ships with a default password.

**Requirements:** Docker with the Compose plugin (Docker Desktop is fine), `openssl`, `curl`.

| Platform | Supported? |
|---|---|
| Linux | ✓ natively |
| macOS (Intel & Apple Silicon) | ✓ natively, via Docker Desktop |
| Windows | ✓ **via WSL2 only** — install Docker Desktop (WSL2 backend), then clone and run inside your WSL distribution. Git Bash / PowerShell are not supported (bind-mount paths break) |

After install, sign in at your URL. Integrations are **off by default** and documented in the generated `.env`: outbound email (SES), Stripe billing, Gmail intake, AI extraction (admins can set a key, or each user brings their own in Settings). **SHAAM/ITA allocation is off and stays off** until you hold your own Israel Tax Authority software registration — issuing legal Israeli tax invoices requires it.

- **Update:** `git pull && docker compose up -d --build app cron`
- **Back up:** `.env` and `local-secrets/` are this installation's identity. Also dump the database and copy the file-storage volume; those hold the records.
- **Uninstall:** `docker compose down -v` (destroys all data), then delete the folder
- **Beyond localhost:** put a TLS reverse proxy in front and re-check the MinIO URL settings in `.env` — the installer's final output explains

---

## 1. Purpose

Build a **multi-tenant** invoice operations product: each **person** (tenant) has an **isolated** workspace, a **private dashboard**, and full control over their expense and income records. The system supports **loading any invoice document** supplied to it; **how** files arrive (e.g. a future per-user Telegram bot) is **out of scope** for this plan and can be plugged in later behind a stable “ingestion” boundary.

---

## 2. Tenancy and identity

- The product serves **many independent users**. No user sees another’s data.
- Each user has a **dedicated dashboard URL or entry point** (conceptually: one dashboard per person).
- All records, files, rules, and preferences are **scoped to exactly one user**.

---

## 3. Document intake (generic)

- Users must be able to **submit invoice files** through whatever channel you implement (upload, API, automation). The plan only requires: accepted files are **associated with the correct user**, **stored durably**, and **passed to extraction**.
- Enforce a **maximum file size** policy per upload (configurable).
- **Receipt of the file** is enough for pipeline start; transport details are implementation-specific.

---

## 4. Text extraction and structured fields

- For each document, the system extracts **machine-readable text** where possible (typical for PDF and similar formats).
- From that text, the system derives a **structured record** including at least:
  - Invoice **date**
  - **Vendor** (for expenses) or **client / counterparty** (for income)
  - **Amount** and **currency**
  - **Invoice number** (or best equivalent)
  - **VAT** when present or applicable
  - A **confidence** indicator (or equivalent) when extraction is uncertain
- A **default** extraction path exists for generic documents; **vendor- or layout-specific** logic may override when a match is detected.

---

## 5. Pluggable extraction rules

- The system supports **custom rules per vendor or document pattern** (e.g. special amount placement, currency, VAT handling, filtering noise such as pro-forma or non-invoice pages).
- Rules are **ordered**: specific matchers run before the generic fallback.
- Operators can **calibrate** the system using sample documents (try extraction, adjust rules, optionally generate a new rule from examples).

---

## 6. Income vs expense

- The product distinguishes **money out (expenses)** from **money in (income)**.
- Each user configures **which client or entity names** (or equivalent identifiers) count as **income** for them; other invoices default to **expense** unless overridden.
- **Separate ledgers** (or clearly separated views and exports) exist for expenses and income, with appropriate column semantics (e.g. “provider” vs “client”).

---

## 7. Duplicate detection

- Before treating a document as new, the system checks for **duplicates** against both **pending** items and **approved** records (same user only), using invoice identifiers, amounts, dates, and file characteristics as appropriate.
- Duplicates should be **flagged or blocked** according to policy—not silently double-booked.

---

## 8. Pending approval workflow

- **Nothing is written to the official ledger** until an item is **approved** (except what is required to hold the queue itself).
- New extractions go to a **pending queue** per user, with:
  - Structured fields (editable)
  - Link or reference to the **stored file**
  - **Status** (e.g. pending, rejected, approved)
- The user can **edit** any extracted field while pending, **reject** with a reason, or **approve**.

---

## 9. On approval

When an item is **approved**:

- The **file** is moved (or registered) under a **year/month folder convention** based on **business rules** (e.g. “added” date vs invoice date—configurable clarity in the product).
- The record is appended to a **master** list for that user.
- A **period roll-up** (e.g. monthly slice of the same data) is updated if your model uses one.
- **Public or semi-public links** to the file for dashboard preview (if used) are recorded on the row.
- The pending entry is **closed** in a way that preserves audit history if required.

---

## 10. Rejection and audit

- Rejected items remain traceable (status + optional reason) without entering the official ledger.
- Optional: retain or delete binary files on reject per policy.

---

## 11. Data model (behavioral, not technical)

- Persist, per user:
  - **Expense** rows: date, provider, amount, currency, invoice number, file reference, date added, VAT, path used for serving/preview, workflow **status** (e.g. OK, needs review).
  - **Income** rows: same idea with **client** instead of provider where applicable.
  - **Pending** rows: same fields as needed for approval, plus pending-specific identifiers.
- A **database** can hold metadata and indices; **large binaries** typically live in **object or file storage** with references in the database. Exact split is an implementation choice.

---

## 12. Dashboard (per user)

Each user gets a **web dashboard** (or equivalent client) that includes at least:

### 12.1 Expenses

- Tabular view of **approved expenses** with sorting and filtering.
- **Charts** summarizing spend (e.g. by time, vendor—exact chart types are flexible).
- **Export** of the visible dataset (e.g. downloadable table in a common interchange format).

### 12.2 Income

- Same class of capabilities for **income** records, with correct labeling (client vs vendor).

### 12.3 Pending invoices

- List of **all pending** items for that user.
- **Split view**: document preview on one side, **editable form** on the other.
- Actions: **save edits**, **reject**, **approve** (with validation where needed).

### 12.4 Needs manual review (approved ledger)

- Surface records marked as **needing review** (extraction or business rules flagged them).
- **Filters** should include: vendor/client, year, month shortcuts, **date range**, and a control to **clear filters** and return to the default “flagged only” view.
- Filters combine with **logical AND**; show a **clear status line** (what is filtered, how many rows).
- **Summary count** for the current filtered set.
- Allow **opening an item**, correcting fields, and **saving** back to the ledger; optionally **move/rename** the file when correcting storage location.
- When an item is fixed, **status** transitions from needs-review to **OK** (or equivalent).

### 12.5 Editing approved rows (general)

- From the main expense/income views, users can **edit** fields and have **master and any roll-up views** stay consistent.

---

## 13. Historical period protection

- The product can **lock** past **month** (or year) **folders or periods** so they are not accidentally changed (manual unlock when corrections are required).
- An **automatic** job can lock all periods **older than the current month** on a schedule.
- Unlock/relock is available for **specific month, year, or everything**, per user.

---

## 14. Daily summary and “missed” hints

- **Optional** scheduled job per user: send a **digest** (e.g. email) listing **records added today** (by “added” date).
- Optionally, integrate with the user’s **mailbox** (with consent) to list **messages that might be invoices** received in the last day as **candidates they may have forgotten to upload**—clearly labeled as hints, not booked transactions.
- Optional: push the same “missed candidates” summary to another channel the user configures.

---

## 15. Notifications and contacts

- Per user: **recipient address** (or channel) for digests and system messages.
- **Sender identity** for outbound mail (or equivalent) is configurable per deployment.

---

## 16. Deployment and versioning of the dashboard

- The **dashboard** is **rebuilt or refreshed** when underlying data or static assets change so users always see current numbers after approvals and edits.
- **Deployment history** (rollback, audit of what was live when) is desirable for operations.

---

## 17. Operational knowledge (per user)

- Support **documented rules** that operators or automation can follow: **vendor-specific extraction notes**, **workflow steps**, and **edge cases**. These may live as **data** or **attached documents** in the product, not only as free-form files on disk.
- A **self-improvement** principle: when something goes wrong, fix the data **and** update the rule so it does not recur.

---

## 18. Limits and safety

- Enforce **upload size limits**.
- **Reject** or **quarantine** unreadable or empty extractions with a visible reason in the pending UI.

---

## 19. Explicitly deferred (to your later work)

- **Telegram (or any specific messenger) bots**, group routing, and “send file from chat to backend” flows: **not part of this feature list** beyond the requirement that **ingestion** must be able to **authenticate the user** and **attach files to the correct tenant** when you add them.

---

## 20. Summary checklist


| Area                                                    | Included |
| ------------------------------------------------------- | -------- |
| Multi-user isolation                                    | Yes      |
| Per-user dashboard                                      | Yes      |
| Generic invoice loading                                 | Yes      |
| Text extraction + structured fields                     | Yes      |
| Default + vendor-specific rules                         | Yes      |
| Calibration / rule tuning                               | Yes      |
| Income vs expense + config for income entities          | Yes      |
| Duplicate detection                                     | Yes      |
| Pending queue + edit + approve/reject                   | Yes      |
| Approved storage + master + optional monthly roll-up    | Yes      |
| Full dashboard: expenses, income, pending, needs-review | Yes      |
| Filters, charts, export, status indicators              | Yes      |
| Edit approved and pending rows                          | Yes      |
| Lock/unlock historical periods + optional auto-lock     | Yes      |
| Daily digest + optional mailbox “missed” hints          | Yes      |
| Notification recipient configuration                    | Yes      |
| Refresh/deploy dashboard with current data              | Yes      |
| Per-tenant operational rules and workflow knowledge     | Yes      |
| File size limits and empty-document handling            | Yes      |


This plan is sufficient to specify a **general invoice application** allocatable to **any person**, each with **their own dashboard** and **shared feature set**, without dictating implementation technology.

---

## Repository: implementation

This repo also contains a **Next.js** application that implements the plan. See **`PLAN.md`** for the technical stack and architecture.

**Run locally:** copy `.env.example` to `.env`, fill the variables below, run `npm install` and `npm run dev`, then open `http://localhost:3000`.

**Deploy with Docker:** see **`docker-compose.yml`** and copy **`.env.docker.example`** to `.env` in the same directory as the compose file (on the server, typically next to `docker-compose.yml`).

### Deploying from your laptop without losing server secrets

Production **`~/invoices/.env` lives only on the server** (it is gitignored and must not be committed). Updating **`.env.docker.example`** in the repo does **not** change the running server until you edit **`~/invoices/.env`** there yourself.

If you **`rsync`** (or similar) from your machine to `~/invoices`, be careful:

- **`rsync --delete`** removes files on the server that are not in your local folder. Because **`.env` is usually missing locally**, a naive sync can **delete** **`~/invoices/.env`** and wipe your URLs and passwords.
- **Fix:** always **exclude** the real env file from sync, e.g.  
  `rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' --exclude '.env' ./ $DEPLOY_SSH_TARGET:~/invoices/`

After a code-only deploy, rebuild/restart if needed:  
`ssh $DEPLOY_SSH_TARGET 'cd ~/invoices && docker compose up -d --build'`

So: **nothing is “gone” from changing only local templates** — but **a bad rsync can remove `.env`**. Excluding **`.env`** (and optionally Postgres/MinIO data if you ever sync volumes) keeps production safe.

### Keeping a local “source of truth” and copying to the server

Yes, that workflow **makes sense**:

1. Maintain a **filled-in env file only on your machine** (e.g. copy **`.env.docker.example`** to **`.env.server`**, edit secrets and URLs). **`.env.server`** is listed in **`.gitignore`**, so it is **not** committed to git.
2. When you deploy or change config, copy it to the server as **`~/invoices/.env`**:
   ```bash
   scp .env.server $DEPLOY_SSH_TARGET:~/invoices/.env
   ```
   Then on the server: `cd ~/invoices && docker compose up -d` (add `--build` if code changed).

**Security (same as any secrets file):**

- **Never commit** real secrets — rely on **`.gitignore`** and double-check with `git status` before pushing.
- **In transit:** `scp`/`rsync` over SSH is **encrypted** (good).
- **At rest:** protect your laptop (disk encryption, screen lock); backups of the project folder should not leak `.env.server` into shared drives unless you trust them.
- **On the server:** restrict SSH access; file permissions `chmod 600 ~/invoices/.env` are a good idea.

Using **`.env.docker.example`** in the repo for **structure only** (no real passwords) and **`.env.server`** locally for **real values** is a common, reasonable split.

---

## Environment variables

The app reads configuration from the environment. What you set depends on how you run it.

### Where to fill variables (step by step)

**1) Docker on the server (production)**

Reach the host over SSH as `$DEPLOY_SSH_TARGET` (e.g. `user@host`, set it in your
shell or `~/.ssh/config`) with project path `~/invoices` — the same machine that
serves the public app URL.

| Step | What to do |
|------|------------|
| File location | **`~/invoices/.env`** on the server — same directory as **`docker-compose.yml`**. Nothing else on the machine uses this path for env unless you put it there. |
| Create the file | If it does not exist: `cd ~/invoices && cp .env.docker.example .env` |
| Edit | Use `nano ~/invoices/.env` or any editor. **One variable per line**, `NAME=value`, no spaces around `=`. |

**Lines you must set (or verify) in `~/invoices/.env`:**

| Variable | What to put | Tip |
|----------|-------------|-----|
| `AUTH_URL` | Full URL users type to open the app | Example: `http://involoops.com:3055`. If you put the app behind HTTPS on port 443, use `https://involoops.com` (no port) or whatever URL you actually use. Must match reality or login breaks. |
| `S3_PUBLIC_ENDPOINT` | URL the app uses to reach MinIO’s **S3 API** | Example: `http://minio:9000` on Compose. Nothing outside the server needs to reach it — uploads and downloads are streamed through the app, so MinIO can stay on the private network. |
| `POSTGRES_PASSWORD` | A strong password | Used only inside Docker for the `invoices` database user. You can generate one with `openssl rand -hex 24`. |
| `AUTH_SECRET` | A long random string | Run on your laptop or server: `openssl rand -base64 32` and paste the result. Used for cookies/sessions, not for Postgres. |
| `MINIO_ROOT_USER` | Login name for MinIO | Example: `invoicesminio`. The app reuses this as the S3 “access key”. |
| `MINIO_ROOT_PASSWORD` | Strong password for MinIO | The app reuses this as the S3 “secret key”. Can be different from `POSTGRES_PASSWORD`. |
| `MINIO_SERVER_URL` | Public URL of the **MinIO S3 API** | Same host you use for `S3_PUBLIC_ENDPOINT` (e.g. `https://s3api.involoops.com`). **Required** if the Console UI and API use different hostnames; without it the Console can load forever and not list objects. |
| `MINIO_BROWSER_REDIRECT_URL` | Public URL of the **MinIO Console** (web UI) | e.g. `https://s3.involoops.com`. Pairs with `MINIO_SERVER_URL` so the browser UI knows where to call the API. |
| `ANTHROPIC_API_KEY` | Your Anthropic API key, or leave empty | Optional. Only for **scanned** PDFs when text extraction fails. If empty, the rest of the app still works. |

After changing `.env`, reload the stack: `cd ~/invoices && docker compose up -d` (add `--build` only if you changed code or `Dockerfile`).

**Sandbox (parallel stack on the same host)** — Second full deployment under `~/invoices_sandbox` with its own Postgres, MinIO, and ports (app **3056**, MinIO API **9107**). Use domain **`sandbox.involoops.com`** (and separate MinIO hostnames). See **[docs/deployment-sandbox.md](docs/deployment-sandbox.md)** and deploy from your laptop with **`./sandbox_deploy.sh`** (requires local **`.env.sandbox`**).

**You do not** manually add `DATABASE_URL`, `S3_BUCKET`, `NEXTAUTH_URL`, etc. in that file for the standard compose setup — Compose derives or duplicates them from the variables above (see the tables below).

---

**2) Local development on your computer (no Docker)**

| Step | What to do |
|------|------------|
| File location | **`.env`** in the **project root** (next to `package.json`), not inside `src/`. |
| Create | `cp .env.example .env` |
| Edit | Fill **`DATABASE_URL`** (your local or hosted Postgres), **`AUTH_SECRET`** (`openssl rand -base64 32`), and the **`S3_*`** variables if you test uploads (your own MinIO, R2, or S3 bucket). |

For local dev, `DATABASE_URL` looks like:  
`postgresql://USER:PASSWORD@localhost:5432/invoices`  
(create the database first). For uploads without cloud accounts, run MinIO locally and set `S3_ENDPOINT` to its API URL (e.g. `http://127.0.0.1:9000`), plus bucket and keys.

---

### Docker deployment (`.env` next to `docker-compose.yml`)

Template: `**.env.docker.example**`. These values are passed into the `app` container (and used by Postgres / MinIO where noted).


| Variable                  | Required       | What it is for                                                                                                                                                                                                                                                             |
| ------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**AUTH_URL**`            | Yes            | Public **canonical URL of the web app** (scheme + host + port), e.g. `http://your-host:3055`. Auth.js uses this so login redirects, callbacks, and session cookies match the address users actually open. If this is wrong, sign-in and redirects break.                   |
| `**NEXTAUTH_URL`**        | Set by Compose | Same as `AUTH_URL` in our compose file. NextAuth/Auth.js expects this name in many setups; we duplicate `AUTH_URL` so both are consistent.                                                                                                                                 |
| `**AUTH_TRUST_HOST**`     | Set by Compose | Tells Auth.js to trust the `Host` header when behind a reverse proxy or Docker port mapping. Set to `true` in `docker-compose.yml`.                                                                                                                                        |
| `**AUTH_SECRET**`         | Yes            | Long random secret used to **sign and encrypt session tokens and cookies**. If leaked, sessions can be forged. Generate with e.g. `openssl rand -base64 32`.                                                                                                               |
| `**POSTGRES_PASSWORD`**   | Yes            | Password for the `**invoices` Postgres user** inside the stack. Compose builds `DATABASE_URL` from this; the app uses it to connect to the database.                                                                                                                       |
| `**S3_PUBLIC_ENDPOINT`**  | Yes            | **MinIO S3 API URL as seen by the browser** (e.g. `http://your-host:9105`). The app generates **presigned upload URLs** pointing here; the user’s browser uploads directly to MinIO, so this host and port must be reachable from the client, not only from inside Docker. |
| `**MINIO_ROOT_USER`**     | Yes            | MinIO **root account name**. Used both to **administer MinIO** and, in our compose file, as `**S3_ACCESS_KEY`** for the app so the Next.js server can talk to the same bucket.                                                                                             |
| `**MINIO_ROOT_PASSWORD**` | Yes            | MinIO **root password**. Also passed through as `**S3_SECRET_KEY`** for the app.                                                                                                                                                                                           |
| `**ANTHROPIC_API_KEY**`   | No             | If set, enables **Claude vision** extraction when a PDF has no usable text (scanned images). If empty, the app still runs; only that fallback is disabled.                                                                                                                 |


**Set automatically in `docker-compose.yml` (you do not put these in `.env` unless you override):**


| Variable                              | Purpose                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**DATABASE_URL`**                    | Built as `postgres://invoices:${POSTGRES_PASSWORD}@postgres:5432/invoices` — connects the app to the **Postgres** service on the Docker network.                                                      |
| `**S3_ENDPOINT`**                     | Same logical storage as `S3_PUBLIC_ENDPOINT`, but **MinIO’s API endpoint** must match what the SDK uses to sign URLs; we set it to `S3_PUBLIC_ENDPOINT` so signatures match the URL the browser uses. |
| `**S3_BUCKET`**                       | Bucket name for invoice files (`invoices`), created by the `minio-init` container.                                                                                                                    |
| `**S3_ACCESS_KEY` / `S3_SECRET_KEY**` | Copied from `**MINIO_ROOT_USER**` / `**MINIO_ROOT_PASSWORD**` so the app authenticates to MinIO as S3.                                                                                                |
| `**S3_REGION**`                       | AWS SDK compatibility; often `us-east-1` for MinIO.                                                                                                                                                   |


**Local development (`.env` in project root)**

Template: `**.env.example`**. Use when running `npm run dev` or `npm run start` **without** Docker.


| Variable                              | Required          | What it is for                                                                                                                                   |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `**DATABASE_URL`**                    | Yes               | Full **Postgres connection string** (host, user, password, database name). The ORM connects to this for users, invoices, vendors, sessions, etc. |
| `**AUTH_SECRET`**                     | Yes               | Same role as in Docker: **session signing** for Auth.js.                                                                                         |
| `**ANTHROPIC_API_KEY`**               | No                | Optional **vision** extraction for scanned PDFs.                                                                                                 |
| `**S3_ENDPOINT`**                     | Yes (for uploads) | **S3-compatible API** base URL (e.g. Cloudflare R2, AWS S3, or MinIO). Used with path-style addressing in code.                                  |
| `**S3_BUCKET`**                       | Yes (for uploads) | Bucket where **invoice PDFs** are stored.                                                                                                        |
| `**S3_ACCESS_KEY` / `S3_SECRET_KEY`** | Yes (for uploads) | **API credentials** for that bucket.                                                                                                             |
| `**S3_REGION`**                       | Often             | Region label (e.g. `auto` for R2).                                                                                                               |


If you also set `**AUTH_URL**` / `**NEXTAUTH_URL**` locally, point them at your dev URL (e.g. `http://localhost:3000`) so OAuth/callback behavior stays consistent if you add providers later.

---

### Quick reference: why each *group* matters

- **Auth (`AUTH_SECRET`, `AUTH_URL`, …):** so users can **log in securely** and sessions match the site URL.
- **Database (`DATABASE_URL` / `POSTGRES_PASSWORD`):** all **structured data** (accounts, invoices, vendors) lives here.
- **Object storage (`S3_`* / MinIO):** **PDF files** and presigned upload/download; without it, uploads and processing fail.
- **Anthropic:** optional **smarter extraction** for image-only PDFs.

---

## Licence

InvoLoops is free software, licensed under the **GNU Affero General Public
License, version 3 or (at your option) any later version** — see
[`LICENSE`](./LICENSE). You may use it for any purpose, including
commercially. If you run a modified version as a network service, its users
are entitled to the source of your version under the same licence.

**Commercial licence.** If you want to build on InvoLoops without the AGPL's
obligations — for example, embedding it in a closed product — a commercial
licence is available from the maintainer. Write to
**<support@involoops.com>** with "commercial licence" in the subject.
Contributions are accepted under the
[Contributor Licence Agreement](./CLA.md), which is what makes this possible.

**Name and logo.** The licence covers the code, not the InvoLoops name or
brand — see [`TRADEMARK.md`](./TRADEMARK.md).

**Tax compliance is the operator's responsibility.** Issuing tax documents in
Israel with this software requires the operating business's own registration
with the Israel Tax Authority and its own SHAAM authorisation. Running a copy
does not make anyone a registered software house, and keeping the books and
filing VAT correctly remains the responsibility of whoever operates it.
