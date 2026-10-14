/**
 * Per-customer daily cap on outbound document issuance.
 *
 * A single customer may receive at most N issued documents within one Israel
 * calendar day, where N is `users.max_outbound_invoices_per_customer_per_day`
 * for the business entity's OWNER, or `DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY`
 * when that column is NULL — which it is for every account until someone
 * deliberately overrides it.
 *
 * The cap is a runaway guard, not a billing quota: it exists so a looping API
 * client or a stuck automation cannot burn thousands of fiscal numbers against
 * one customer before anyone notices.
 *
 * EVERY document type counts and every document type is blocked — tax
 * invoices, receipts, proformas, delivery notes and credit notes alike. The
 * cap is on documents issued to a customer, not on any particular kind, so a
 * credit note both consumes a slot and is refused once the day is full.
 *
 * It counts SPENT FISCAL NUMBERS, not successfully signed documents. A
 * document whose number was allocated and then rejected by SHAAM has still
 * consumed a number (see `issueOutboundInvoiceOp`), so it consumes a cap slot
 * too.
 *
 * Documents with no customer (`customer_id IS NULL`) are not capped — there is
 * nothing to attribute them to.
 */

import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessEntities, customers, outboundInvoices, users } from "@/db/schema";
import { startOfIsraelDay } from "@/lib/datetime/today";

/**
 * Product-wide default, applied whenever an account has not set its own
 * override. Deliberately a code constant rather than a column default so
 * changing it takes effect for every non-overridden account at once.
 */
export const DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY = 100;

/** Upper bound on a per-account override, so a bad admin edit can't disable the guard. */
const MAX_CONFIGURABLE_LIMIT = 10_000;

export class OutboundCustomerDailyLimitError extends Error {
  readonly limit: number;
  readonly issuedToday: number;

  constructor(limit: number, issuedToday: number) {
    super(
      `Daily limit reached for this customer: ${issuedToday} of ${limit} documents already issued today. ` +
        `The limit resets at midnight (Israel time).`,
    );
    this.name = "OutboundCustomerDailyLimitError";
    this.limit = limit;
    this.issuedToday = issuedToday;
  }
}

/**
 * Resolve the effective cap for a business entity.
 *
 * Reads the override from the entity's OWNER, never from the acting user: an
 * accountant acting-as must be held to the owner's limit, not their own.
 * Anything missing, non-positive, or absurd falls back to the default.
 */
export async function resolveOutboundCustomerDailyLimit(
  businessEntityId: string,
): Promise<number> {
  const [row] = await db
    .select({ limit: users.maxOutboundInvoicesPerCustomerPerDay })
    .from(businessEntities)
    .innerJoin(users, eq(users.id, businessEntities.ownerUserId))
    .where(eq(businessEntities.id, businessEntityId))
    .limit(1);

  const configured = row?.limit;
  if (
    configured == null ||
    !Number.isInteger(configured) ||
    configured <= 0 ||
    configured > MAX_CONFIGURABLE_LIMIT
  ) {
    return DEFAULT_MAX_OUTBOUND_DOCS_PER_CUSTOMER_PER_DAY;
  }
  return configured;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Throw `OutboundCustomerDailyLimitError` if issuing one more document to
 * `customerId` today would exceed `limit`.
 *
 * MUST be called inside the same transaction that allocates the fiscal
 * number. It takes a row lock on the customer first, which serialises
 * concurrent issues for that customer across every document type — without
 * it, two simultaneous requests would both read a count of 99 and both
 * proceed. The lock is per-customer, so it costs nothing for the common case
 * of issuing to different customers in parallel.
 */
export async function assertOutboundCustomerDailyLimitTx(
  tx: Tx,
  params: {
    businessEntityId: string;
    customerId: string | null;
    limit: number;
  },
): Promise<void> {
  const { businessEntityId, customerId, limit } = params;

  // Nothing to attribute an unassigned document to, so nothing to cap.
  if (!customerId) return;

  // Serialise other issues to this same customer for the rest of the tx.
  await tx.execute(
    sql`select 1 from ${customers} where ${customers.id} = ${customerId} for update`,
  );

  const [row] = await tx
    .select({ issued: count() })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, businessEntityId),
        eq(outboundInvoices.customerId, customerId),
        gte(outboundInvoices.issuedAt, startOfIsraelDay()),
        isNull(outboundInvoices.deletedAt),
      ),
    );

  const issuedToday = row?.issued ?? 0;
  if (issuedToday >= limit) {
    throw new OutboundCustomerDailyLimitError(limit, issuedToday);
  }
}
