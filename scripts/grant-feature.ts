/**
 * Grant or revoke a per-user feature entitlement.
 *
 * Usage:
 *   npx tsx scripts/grant-feature.ts <email> <feature> [options]
 *
 * Options:
 *   --revoke         Revoke the user's active grant for this feature.
 *   --days=N         Grant expires in N days from now (trial). Omit for
 *                    a permanent grant.
 *   --reason="..."   Free-form audit note stored on the row.
 *   --list           Ignore other args; print every active grant for
 *                    <email> and exit.
 *
 * Examples:
 *   # Permanent grant
 *   npx tsx scripts/grant-feature.ts owner@example.com invoice_generator
 *
 *   # 30-day trial with a note
 *   npx tsx scripts/grant-feature.ts owner@example.com invoice_generator \
 *     --days=30 --reason="Closed beta cohort 2026-Q2"
 *
 *   # Revoke
 *   npx tsx scripts/grant-feature.ts owner@example.com invoice_generator --revoke
 *
 *   # Inspect
 *   npx tsx scripts/grant-feature.ts owner@example.com x --list
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema/users";
import { userFeatureGrants } from "../src/db/schema/user-feature-grants";
import { ALL_FEATURES, isFeature } from "../src/lib/features/registry";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: npx tsx scripts/grant-feature.ts <email> <feature> [--revoke] [--days=N] [--reason=\"...\"] [--list]",
  );
  console.error(`Known features: ${ALL_FEATURES.join(", ")}`);
  process.exit(1);
}

const [email, feature, ...rest] = args;

let revoke = false;
let list = false;
let days: number | null = null;
let reason: string | null = null;
for (const a of rest) {
  if (a === "--revoke") {
    revoke = true;
    continue;
  }
  if (a === "--list") {
    list = true;
    continue;
  }
  const daysMatch = a.match(/^--days=(\d+)$/);
  if (daysMatch) {
    days = Number(daysMatch[1]);
    continue;
  }
  const reasonMatch = a.match(/^--reason=(.+)$/);
  if (reasonMatch) {
    reason = reasonMatch[1].replace(/^"(.*)"$/, "$1");
    continue;
  }
  console.error(`Unknown option: ${a}`);
  process.exit(1);
}

async function main() {
  const client = postgres(connectionString!);
  const db = drizzle(client, { schema });

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  if (list) {
    const rows = await db
      .select()
      .from(userFeatureGrants)
      .where(
        and(
          eq(userFeatureGrants.userId, user.id),
          isNull(userFeatureGrants.revokedAt),
        ),
      );
    if (rows.length === 0) {
      console.log(`No active grants for ${email}.`);
    } else {
      console.log(`Active grants for ${email}:`);
      for (const r of rows) {
        const exp = r.expiresAt ? r.expiresAt.toISOString() : "permanent";
        const why = r.reason ? ` — ${r.reason}` : "";
        console.log(`  - ${r.feature}  (expires: ${exp})${why}`);
      }
    }
    await client.end();
    process.exit(0);
  }

  if (!isFeature(feature)) {
    console.error(`Unknown feature: ${feature}`);
    console.error(`Known features: ${ALL_FEATURES.join(", ")}`);
    process.exit(1);
  }

  // Find any existing active grant (one per (user, feature) by index).
  const existing = await db
    .select()
    .from(userFeatureGrants)
    .where(
      and(
        eq(userFeatureGrants.userId, user.id),
        eq(userFeatureGrants.feature, feature),
        isNull(userFeatureGrants.revokedAt),
      ),
    )
    .limit(1);

  const now = new Date();

  if (revoke) {
    if (existing.length === 0) {
      console.log(`No active grant to revoke (${email}, ${feature}).`);
    } else {
      await db
        .update(userFeatureGrants)
        .set({ revokedAt: now })
        .where(eq(userFeatureGrants.id, existing[0].id));
      console.log(`Revoked ${feature} for ${email}.`);
    }
    await client.end();
    process.exit(0);
  }

  const expiresAt =
    days != null
      ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
      : null;

  if (existing.length > 0) {
    // Refresh expiry / reason; do NOT create a duplicate row (the partial
    // unique index would reject it anyway).
    await db
      .update(userFeatureGrants)
      .set({
        expiresAt,
        reason: reason ?? existing[0].reason,
      })
      .where(eq(userFeatureGrants.id, existing[0].id));
    const exp = expiresAt ? expiresAt.toISOString() : "permanent";
    console.log(`Updated ${feature} for ${email} (expires: ${exp}).`);
  } else {
    await db.insert(userFeatureGrants).values({
      userId: user.id,
      feature,
      expiresAt,
      reason,
    });
    const exp = expiresAt ? expiresAt.toISOString() : "permanent";
    console.log(`Granted ${feature} to ${email} (expires: ${exp}).`);
  }

  await client.end();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("grant-feature failed:", err);
  process.exit(1);
});
