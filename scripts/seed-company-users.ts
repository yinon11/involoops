/**
 * Upsert a user and set their company name.
 *
 * Creates the row with no password hash, which is what a Google-only account
 * looks like before its first sign-in: the person signs in with Google and
 * Auth.js links the OAuth account to this row by email. Re-running against an
 * existing email updates the name and company instead.
 *
 *   npx tsx scripts/seed-company-users.ts <email> <name> <companyName>
 *
 * Example:
 *   npx tsx scripts/seed-company-users.ts owner@example.com "Jane Cohen" "Example Ltd"
 *
 * Loads DATABASE_URL from .env in the project root if it is not already set.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

loadEnvFile();

function usage(message: string): never {
  console.error(`${message}

Usage:
  npx tsx scripts/seed-company-users.ts <email> <name> <companyName>

Example:
  npx tsx scripts/seed-company-users.ts owner@example.com "Jane Cohen" "Example Ltd"`);
  process.exit(1);
}

async function main() {
  const [email, name, companyName] = process.argv.slice(2);

  if (!email || !name || !companyName) {
    usage("Expected three arguments: email, name, companyName.");
  }
  if (!email.includes("@")) {
    usage(`"${email}" is not an email address.`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(databaseUrl);

  try {
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `;

    if (existing.length === 0) {
      await sql`
        INSERT INTO users (email, name, company_name, password_hash)
        VALUES (${email}, ${name}, ${companyName}, NULL)
      `;
      console.log(`Created ${email} — sign in with Google to link the account.`);
    } else {
      await sql`
        UPDATE users
        SET name = ${name}, company_name = ${companyName}
        WHERE email = ${email}
      `;
      console.log(`Updated ${email}.`);
    }
  } finally {
    await sql.end();
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
