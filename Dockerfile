# Build and run Next.js app (Drizzle migrations run at container start)
FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl ca-certificates \
  chromium fonts-noto fonts-noto-cjk fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
# dotenv is a production dependency so DB seed scripts (import "dotenv/config") work
# when node_modules is installed with devDependencies omitted (e.g. npm ci --omit=dev).
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Drop privileges: a compromised Node process shouldn't have root inside the
# container. The `node` user ships with the official node image.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Container start sequence:
#   1. ensure-archive-bucket-lock.mjs — MinIO Object Lock for the archive bucket.
#   2. mark-migrations-applied.mjs    — one-shot bootstrap that seeds
#      drizzle.__drizzle_migrations from drizzle/meta/_journal.json the first
#      time we boot against an existing populated DB. No-op on every other
#      invocation (fresh DB or already-bootstrapped). Required because we used
#      to run `drizzle-kit push` and never tracked applied SQL files. See the
#      script's header comment for the full rationale.
#   3. drizzle-kit migrate            — applies any new numbered SQL files in
#      `drizzle/` whose hash isn't yet recorded in
#      `drizzle.__drizzle_migrations`. Replaces the previous `drizzle-kit
#      push`, which silently swallowed prompts (e.g. unique-constraint on a
#      table with conflicting data) and led to schema drifts going un-applied
#      on prod.
#   4. ensure-company-column.mjs      — additive column safety net retained
#      from the legacy boot sequence.
#   5. npm run start                  — Next.js production server.
#
# `set -e` makes the chain fail-fast: any boot step that errors stops the
# container from starting, instead of leaving a half-migrated app running
# (the failure mode that hid the missing 0008_uefs_active_unique on prod).
# Steps 2–4 touch the schema, so they run as the DB owner via
# MIGRATE_DATABASE_URL when compose provides it (unset → falls back to
# DATABASE_URL, so a single-role setup keeps working). The served app (step 5)
# stays on DATABASE_URL — in production that is the non-superuser invoices_app
# role, which cannot UPDATE/DELETE the audit log (scripts/sql/create-app-role.sql).
CMD ["sh", "-c", "set -e; \
  node scripts/ensure-archive-bucket-lock.mjs && \
  DATABASE_URL=\"${MIGRATE_DATABASE_URL:-$DATABASE_URL}\" node scripts/mark-migrations-applied.mjs && \
  DATABASE_URL=\"${MIGRATE_DATABASE_URL:-$DATABASE_URL}\" npx drizzle-kit migrate && \
  DATABASE_URL=\"${MIGRATE_DATABASE_URL:-$DATABASE_URL}\" node scripts/ensure-company-column.mjs && \
  exec npm run start"]
