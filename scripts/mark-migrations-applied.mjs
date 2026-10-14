/**
 * One-shot bootstrap for `drizzle-kit migrate` adoption.
 *
 * Background: this repo used `drizzle-kit push` for years. Numbered SQL
 * files in `drizzle/` were applied either by accident (when their effect
 * overlapped what `push` derived from `src/db/schema/*.ts`) or by hand
 * via `psql -f` (see `drizzle/legacy/README.md`). When we switch the
 * Dockerfile from `push` to `migrate`, the runner walks
 * `drizzle/meta/_journal.json` and applies every entry whose hash isn't
 * in `drizzle.__drizzle_migrations` — but on prod / sandbox the table
 * is empty, so a naive switch would re-apply `0000_baseline_full_schema.sql`
 * (and everything after) against a database where every table already
 * exists. That fails on the first conflicting `CREATE TABLE`.
 *
 * This script paves over the transition exactly once per environment.
 * It auto-detects the situation and only acts when it's safe to:
 *
 *   - tracking table missing OR empty AND
 *   - the `users` table already exists (i.e. the DB is already populated
 *     by the previous `push`-driven workflow)
 *
 * In that case it inserts a row in `drizzle.__drizzle_migrations` for
 * every entry in `_journal.json`, claiming "already applied" without
 * running any SQL. The hash matches what `drizzle-kit migrate` would
 * compute on the next boot, so `migrate` then sees nothing to do.
 *
 * On every subsequent run (and on a brand-new empty DB) it's a no-op:
 *   - if tracking is non-empty, we don't touch it
 *   - if tracking is empty and `users` doesn't exist yet, this is a
 *     fresh install — do nothing and let `migrate` apply 0000+ normally
 *
 * Safe to wire into the Dockerfile CMD before `drizzle-kit migrate`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("mark-migrations-applied: DATABASE_URL is not set");
  process.exit(1);
}

const journalPath = join("drizzle", "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8"));

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id         serial PRIMARY KEY,
      hash       text   NOT NULL,
      created_at bigint
    )
  `;
  // Drizzle's own `migrate` does not create this index; we add it so
  // our INSERT ... ON CONFLICT below stays idempotent across re-runs.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS __drizzle_migrations_hash_uq
      ON drizzle.__drizzle_migrations (hash)
  `;

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `;
  if (count > 0) {
    console.log(
      `mark-migrations-applied: tracking table has ${count} rows; nothing to do`,
    );
    process.exit(0);
  }

  const [{ exists: usersExists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists
  `;
  if (!usersExists) {
    console.log(
      "mark-migrations-applied: fresh database (no `users` table); leaving tracking table empty so `drizzle-kit migrate` applies 0000+ normally",
    );
    process.exit(0);
  }

  console.log(
    `mark-migrations-applied: existing populated database with empty tracking table — bootstrapping ${journal.entries.length} entries from _journal.json`,
  );

  for (const entry of journal.entries) {
    const body = readFileSync(join("drizzle", `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(body).digest("hex");
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${entry.when})
      ON CONFLICT (hash) DO NOTHING
    `;
    console.log(`  ✓ ${entry.tag}`);
  }
} finally {
  await sql.end();
}
