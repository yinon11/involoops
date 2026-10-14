/**
 * Seed pricing tiers into the database.
 * Run: npx tsx scripts/seed-pricing-tiers.ts
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pricingTiers } from "../src/db/schema/pricing-tiers";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client);

const tiers = [
  {
    name: "Free",
    code: "free",
    maxInvoicesPerMonth: 10,
    priceMonthly: "0",
    features: JSON.stringify([
      "10 invoices per month",
      "PDF extraction with AI",
      "Vendor management",
      "Dashboard & analytics",
    ]),
    sortOrder: 0,
  },
  {
    name: "Professional",
    code: "professional",
    maxInvoicesPerMonth: 50,
    priceMonthly: "5.00",
    stripePriceIdMonthly: "price_1TJErBEsJ5iMOh4XXD1FUHSa",
    features: JSON.stringify([
      "50 invoices per month",
      "Everything in Free",
      "Priority extraction",
      "Email support",
    ]),
    sortOrder: 1,
  },
  {
    name: "Business",
    code: "business",
    maxInvoicesPerMonth: 150,
    priceMonthly: "12.00",
    stripePriceIdMonthly: "price_1TJEuAEsJ5iMOh4Xpf7ExFGP",
    features: JSON.stringify([
      "150 invoices per month",
      "Everything in Professional",
      "Bulk ZIP upload",
      "Export to Excel",
    ]),
    sortOrder: 2,
  },
  {
    name: "Enterprise",
    code: "enterprise",
    maxInvoicesPerMonth: 500,
    priceMonthly: "25.00",
    stripePriceIdMonthly: "price_1TJEumEsJ5iMOh4XjqDQel2A",
    features: JSON.stringify([
      "500 invoices per month",
      "Everything in Business",
      "Priority support",
      "Custom extraction rules",
    ]),
    sortOrder: 3,
  },
];

async function main() {
  console.log("Seeding pricing tiers...");

  for (const tier of tiers) {
    await db
      .insert(pricingTiers)
      .values(tier)
      .onConflictDoUpdate({
        target: pricingTiers.code,
        set: {
          name: tier.name,
          maxInvoicesPerMonth: tier.maxInvoicesPerMonth,
          priceMonthly: tier.priceMonthly,
          stripePriceIdMonthly: (tier as { stripePriceIdMonthly?: string | null }).stripePriceIdMonthly ??
            null,
          features: tier.features,
          sortOrder: tier.sortOrder,
        },
      });
    console.log(`  ✓ ${tier.name} (${tier.code}) - $${tier.priceMonthly}/mo, ${tier.maxInvoicesPerMonth} invoices`);
  }

  console.log("Done!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
