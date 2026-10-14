/**
 * Create the first admin account. Used by install.sh inside the app
 * container; safe to run by hand the same way:
 *
 *   docker exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='...' \
 *     [-e ADMIN_NAME='Your Name'] invoices-app npx tsx scripts/create-admin.ts
 *
 * Values come from env, not argv. Standalone postgres-js client + schema
 * imports only (no "@/db" — that path drags server-only modules that
 * refuse to load outside Next.js). Mirrors the register action:
 * bcrypt(12) password, free tier subscription, email preferences row.
 * The email is marked verified — there is no mail service yet to verify
 * through, and this is the operator's own account.
 *
 * An existing user with the same email is promoted to admin; the
 * password is NOT changed (reset it through the app if forgotten).
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { users } from "../src/db/schema/users";
import { pricingTiers } from "../src/db/schema/pricing-tiers";
import { userSubscriptions } from "../src/db/schema/user-subscriptions";
import { userEmailPreferences } from "../src/db/schema/user-email-preferences";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Admin";
  if (!email || !email.includes("@")) throw new Error("ADMIN_EMAIL is not a valid email address");
  if (!password || password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  try {
    const existing = await db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      if (existing[0].isAdmin) {
        console.log(`${email} already exists and is already an admin — nothing to do.`);
        return;
      }
      await db.update(users).set({ isAdmin: true }).where(eq(users.id, existing[0].id));
      console.log(`${email} already existed — promoted to admin (password unchanged).`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, isAdmin: true, emailVerified: new Date() })
      .returning({ id: users.id });

    // Same follow-ups as the register action (minus the funnel event —
    // funnels are off on a fresh self-host install).
    const [freeTier] = await db.select({ id: pricingTiers.id }).from(pricingTiers).where(eq(pricingTiers.code, "free"));
    if (freeTier) {
      await db.insert(userSubscriptions).values({ userId: user.id, pricingTierId: freeTier.id, status: "free" });
    } else {
      console.warn("WARN: no 'free' pricing tier found — run scripts/seed-pricing-tiers.ts first.");
    }
    await db.insert(userEmailPreferences).values({ userId: user.id });

    console.log(`Admin created: ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`create-admin failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
