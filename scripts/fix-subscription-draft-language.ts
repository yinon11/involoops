/**
 * Set language=he on subscription billing drafts (Stripe id in notes).
 *
 *   npx tsx scripts/fix-subscription-draft-language.ts
 *   npx tsx scripts/fix-subscription-draft-language.ts --dry-run
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull, like } from "drizzle-orm";
import { outboundInvoices } from "../src/db/schema/outbound-invoices";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  const rows = await db
    .select({
      id: outboundInvoices.id,
      formattedNumber: outboundInvoices.formattedNumber,
      language: outboundInvoices.language,
      notes: outboundInvoices.notes,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.status, "draft"),
        isNull(outboundInvoices.deletedAt),
        like(outboundInvoices.notes, "%Stripe:%"),
      ),
    );

  let updated = 0;
  for (const row of rows) {
    if (row.language === "he") continue;
    console.log(
      `${dryRun ? "[dry-run] " : ""}→ he  ${row.id.slice(0, 8)}  ${row.notes?.slice(0, 60) ?? ""}`,
    );
    if (!dryRun) {
      await db
        .update(outboundInvoices)
        .set({ language: "he", updatedAt: new Date() })
        .where(eq(outboundInvoices.id, row.id));
    }
    updated++;
  }

  console.log(`\nDone. ${updated} draft(s) ${dryRun ? "would be " : ""}updated.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
