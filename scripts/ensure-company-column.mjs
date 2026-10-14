/**
 * Idempotent additive migration for Docker/host deploys.
 * Runs before drizzle-kit push so session callbacks never hit a missing column.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ensure-company-column: DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url);
try {
  await sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_name" varchar(255)`;
} finally {
  await sql.end();
}
