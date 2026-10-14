/**
 * Read or set an account's per-customer daily outbound-document cap.
 *
 * The cap limits how many documents may be issued to a SINGLE customer
 * within one Israel calendar day. Accounts with no override use the
 * product default (`DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY`), so a
 * fresh account needs no row here at all — this script is only for
 * deliberately raising or lowering one account.
 *
 * The override belongs to the OWNER of the business entity; enforcement
 * reads it from there, so pass the owner's email, not an accountant's.
 *
 * Usage:
 *   npx tsx scripts/set-outbound-customer-daily-limit.ts <email>            # show
 *   npx tsx scripts/set-outbound-customer-daily-limit.ts <email> <limit>    # set
 *   npx tsx scripts/set-outbound-customer-daily-limit.ts <email> --reset    # back to default
 *
 * Examples:
 *   npx tsx scripts/set-outbound-customer-daily-limit.ts ops@acme.com 500
 *   npx tsx scripts/set-outbound-customer-daily-limit.ts ops@acme.com --reset
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema/users";
import { DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY } from "../src/lib/outbound/customer-daily-limit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(
    "Usage: npx tsx scripts/set-outbound-customer-daily-limit.ts <email> [<limit>|--reset]",
  );
  process.exit(1);
}

const [email, valueArg] = args;

async function main() {
  const client = postgres(connectionString!);
  const db = drizzle(client, { schema });

  const user = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${email.toLowerCase()}`,
    columns: {
      id: true,
      email: true,
      maxOutboundInvoicesPerCustomerPerDay: true,
    },
  });
  if (!user) {
    console.error(`User not found: ${email}`);
    await client.end();
    process.exit(1);
  }

  const describe = (value: number | null): string =>
    value == null
      ? `default (${DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY})`
      : String(value);

  if (valueArg == null) {
    console.log(
      `${user.email}: ${describe(user.maxOutboundInvoicesPerCustomerPerDay)} documents per customer per day`,
    );
    await client.end();
    process.exit(0);
  }

  let next: number | null;
  if (valueArg === "--reset") {
    next = null;
  } else {
    const parsed = Number(valueArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error(`Limit must be a positive integer (got: ${valueArg})`);
      await client.end();
      process.exit(1);
    }
    next = parsed;
  }

  await db
    .update(users)
    .set({ maxOutboundInvoicesPerCustomerPerDay: next })
    .where(eq(users.id, user.id));

  console.log(
    `${user.email}: ${describe(user.maxOutboundInvoicesPerCustomerPerDay)} -> ${describe(next)} documents per customer per day`,
  );

  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
