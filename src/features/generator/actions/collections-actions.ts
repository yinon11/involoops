"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { customers, outboundInvoices } from "@/db/schema";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { requireActorUserId as requireUserId } from "@/lib/team/enforce";
import {
  callerFromUserId,
  sendOutboundInvoiceByEmailOp,
  SETTLEABLE_DOC_TYPES,
} from "@/lib/outbound/operations";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n";
import type { DocumentType } from "@/lib/documents/types";
import { convertAmountBetweenCurrencies } from "@/lib/fx";
import { getUserDisplayCurrency } from "@/lib/display-currency";

/** Open statuses — issued but not yet paid or voided. */
const OPEN_STATUSES = ["issued", "sent"] as const;

/**
 * Only debt-bearing documents can be "open for collection".
 * A TAX_INVOICE_RECEIPT (TIR) is settled at issue time by construction —
 * it never sits in `paid` status, so filtering on status alone made every
 * TIR (e.g. the Stripe subscriber receipts created by
 * `lib/billing/studio-receipt.ts`) show up as outstanding. Same source of
 * truth as the outbound list's `paymentState`.
 */
const COLLECTIBLE_DOC_TYPES = [...SETTLEABLE_DOC_TYPES] as DocumentType[];

/**
 * Outstanding balance left on a debt-bearing document:
 * credit-adjusted total minus everything linked RECEIPTs already settled.
 * Rows that reach zero are dropped from collections even if a race left
 * the parent's status at issued/sent.
 */
async function loadReceiptSettlementsByParent(
  businessEntityId: string,
): Promise<Map<string, number>> {
  const receipts = await db
    .select({
      parentId: outboundInvoices.referencesDocumentId,
      total: outboundInvoices.total,
      status: outboundInvoices.status,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, businessEntityId),
        eq(outboundInvoices.documentType, "RECEIPT"),
        isNull(outboundInvoices.deletedAt),
      ),
    );

  const settled = new Map<string, number>();
  for (const r of receipts) {
    if (!r.parentId) continue;
    if (r.status === "voided" || r.status === "draft") continue;
    settled.set(r.parentId, (settled.get(r.parentId) ?? 0) + Number(r.total));
  }
  return settled;
}

/** Outstanding in whole cents so float noise can't leave a 0.00 row open. */
function outstandingCents(
  baseRemaining: string | null,
  total: string,
  settled: number,
): number {
  return Math.round((Number(baseRemaining ?? total) - settled) * 100);
}

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export type AgingBuckets = Record<AgingBucket, { count: number; total: number }>;

export interface AgingRow {
  id: string;
  formattedNumber: string | null;
  customerName: string;
  customerEmail: string | null;
  /** Gross document total. */
  total: string;
  /** What the customer still owes: credit-adjusted total minus linked receipts. */
  outstanding: string;
  currency: string;
  invoiceDate: string;
  daysOutstanding: number;
}

export interface CollectionsDashboardData {
  openCount: number;
  openTotal: number;
  currency: string;
  avgCreditDays: number | null;
  agingBuckets: AgingBuckets;
  agingRows: AgingRow[];
}

const EMPTY_BUCKETS: AgingBuckets = {
  "0-30": { count: 0, total: 0 },
  "31-60": { count: 0, total: 0 },
  "61-90": { count: 0, total: 0 },
  "90+": { count: 0, total: 0 },
};

const EMPTY: CollectionsDashboardData = {
  openCount: 0,
  openTotal: 0,
  currency: "ILS",
  avgCreditDays: null,
  agingBuckets: { ...EMPTY_BUCKETS },
  agingRows: [],
};

/**
 * Lightweight summary used by the creator home page banner.
 * Avoids re-running the full aging table query just for the header card.
 */
export interface OpenInvoicesSummary {
  openCount: number;
  openTotal: number;
  currency: string;
}

export async function getOpenInvoicesSummary(): Promise<OpenInvoicesSummary> {
  const session = await auth();
  if (!session?.user?.id) return { openCount: 0, openTotal: 0, currency: "ILS" };

  const displayCurrency = await getUserDisplayCurrency(session.user.id);
  const entity = await getBusinessEntityForUserOrNull(session.user.id);
  if (!entity) return { openCount: 0, openTotal: 0, currency: displayCurrency };

  const [rows, settledByParent] = await Promise.all([
    db
      .select({
        id: outboundInvoices.id,
        total: outboundInvoices.total,
        netOfCreditsAmount: outboundInvoices.netOfCreditsAmount,
        currency: outboundInvoices.currency,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.businessEntityId, entity.id),
          inArray(outboundInvoices.documentType, COLLECTIBLE_DOC_TYPES),
          inArray(outboundInvoices.status, [...OPEN_STATUSES]),
          isNull(outboundInvoices.deletedAt),
        ),
      ),
    loadReceiptSettlementsByParent(entity.id),
  ]);

  let openTotal = 0;
  let openCount = 0;
  for (const row of rows) {
    const cents = outstandingCents(
      row.netOfCreditsAmount,
      row.total,
      settledByParent.get(row.id) ?? 0,
    );
    if (cents <= 0) continue;
    openCount += 1;
    openTotal += convertAmountBetweenCurrencies(
      cents / 100,
      row.currency ?? "ILS",
      displayCurrency,
    );
  }

  return { openCount, openTotal, currency: displayCurrency };
}

/**
 * Full collections dashboard data:
 *   - Open invoice count + total
 *   - Per-bucket aging breakdown (0-30 / 31-60 / 61-90 / 90+)
 *   - Detailed aging table rows (customer, invoice #, amount, days out)
 *   - Average credit days from paid invoices in last 12 months
 *     (uses `updatedAt` as a proxy for paid date since there is no
 *     dedicated `paidAt` column on plain tax invoices)
 */
export async function getCollectionsDashboardData(): Promise<CollectionsDashboardData> {
  const userId = await requireUserId("view_outbound");
  const displayCurrency = await getUserDisplayCurrency(userId);
  const entity = await getBusinessEntityForUserOrNull(userId);
  if (!entity) return { ...EMPTY, currency: displayCurrency };

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const [openRows, avgRows, settledByParent] = await Promise.all([
    // Open invoices with days outstanding computed in the DB
    db
      .select({
        id: outboundInvoices.id,
        formattedNumber: outboundInvoices.formattedNumber,
        customerName: customers.name,
        customerEmail: customers.email,
        total: outboundInvoices.total,
        netOfCreditsAmount: outboundInvoices.netOfCreditsAmount,
        currency: outboundInvoices.currency,
        invoiceDate: outboundInvoices.invoiceDate,
        daysOutstanding: sql<number>`(current_date - ${outboundInvoices.invoiceDate}::date)::int`,
      })
      .from(outboundInvoices)
      .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
      .where(
        and(
          eq(outboundInvoices.businessEntityId, entity.id),
          inArray(outboundInvoices.documentType, COLLECTIBLE_DOC_TYPES),
          inArray(outboundInvoices.status, [...OPEN_STATUSES]),
          isNull(outboundInvoices.deletedAt),
        ),
      )
      .orderBy(
        sql`(current_date - ${outboundInvoices.invoiceDate}::date) desc`,
      ),

    // Average days from invoice date to mark-paid (last 12 months).
    // Same doc-type filter: a TIR is paid on day zero and would drag the
    // average toward 0, hiding how slowly real invoices actually settle.
    db
      .select({
        avgDays:
          sql<string | null>`avg((${outboundInvoices.updatedAt}::date - ${outboundInvoices.invoiceDate}::date))::text`,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.businessEntityId, entity.id),
          inArray(outboundInvoices.documentType, COLLECTIBLE_DOC_TYPES),
          eq(outboundInvoices.status, "paid"),
          isNull(outboundInvoices.deletedAt),
          gte(outboundInvoices.updatedAt, twelveMonthsAgo),
        ),
      ),

    loadReceiptSettlementsByParent(entity.id),
  ]);

  // Build buckets and aging rows in one pass
  const agingBuckets: AgingBuckets = {
    "0-30": { count: 0, total: 0 },
    "31-60": { count: 0, total: 0 },
    "61-90": { count: 0, total: 0 },
    "90+": { count: 0, total: 0 },
  };

  let openTotal = 0;
  const agingRows: AgingRow[] = [];

  for (const row of openRows) {
    const cents = outstandingCents(
      row.netOfCreditsAmount,
      row.total,
      settledByParent.get(row.id) ?? 0,
    );
    // Fully settled by linked receipts (or fully credited) — not collectible.
    if (cents <= 0) continue;

    const amount = cents / 100;
    const days = row.daysOutstanding;
    const currency = row.currency ?? "ILS";
    const inDisplay = convertAmountBetweenCurrencies(
      amount,
      currency,
      displayCurrency,
    );

    openTotal += inDisplay;

    const bucket: AgingBucket =
      days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    agingBuckets[bucket].count += 1;
    agingBuckets[bucket].total += inDisplay;

    agingRows.push({
      id: row.id,
      formattedNumber: row.formattedNumber,
      customerName: row.customerName ?? "—",
      customerEmail: row.customerEmail?.trim() || null,
      total: row.total,
      outstanding: amount.toFixed(2),
      currency,
      invoiceDate: row.invoiceDate,
      daysOutstanding: days,
    });
  }

  const raw = avgRows[0]?.avgDays;
  const avgCreditDays =
    raw != null && !isNaN(Number(raw)) ? Math.round(Number(raw)) : null;

  return {
    openCount: agingRows.length,
    openTotal,
    currency: displayCurrency,
    avgCreditDays,
    agingBuckets,
    agingRows,
  };
}

export interface SendOutstandingRemindersResult {
  sent: number;
  skippedNoEmail: number;
  failed: { number: string; error: string }[];
}

/**
 * Email a payment-reminder PDF for every invoice that is genuinely still
 * owed and has a customer email. Scoped by the same rule as the aging
 * table — a TIR or a receipt-settled invoice is not a debt, and dunning a
 * customer who already paid is worse than a wrong dashboard number.
 */
export async function sendOutstandingPaymentReminders(): Promise<SendOutstandingRemindersResult> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_outbound");
  const caller = await callerFromUserId(userId);
  const entity = await getBusinessEntityForUserOrNull(userId);
  if (!entity) {
    return {
      sent: 0,
      skippedNoEmail: 0,
      failed: [{ number: "—", error: dict.errors.noBusinessEntity }],
    };
  }

  const copy = dict.homeCards.owesYou;
  const business = entity.legalName.trim() || "InvoLoops";

  const [rows, settledByParent] = await Promise.all([
    db
      .select({
        id: outboundInvoices.id,
        formattedNumber: outboundInvoices.formattedNumber,
        customerName: customers.name,
        customerEmail: customers.email,
        total: outboundInvoices.total,
        netOfCreditsAmount: outboundInvoices.netOfCreditsAmount,
      })
      .from(outboundInvoices)
      .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
      .where(
        and(
          eq(outboundInvoices.businessEntityId, entity.id),
          inArray(outboundInvoices.documentType, COLLECTIBLE_DOC_TYPES),
          inArray(outboundInvoices.status, [...OPEN_STATUSES]),
          isNull(outboundInvoices.deletedAt),
        ),
      ),
    loadReceiptSettlementsByParent(entity.id),
  ]);

  let sent = 0;
  let skippedNoEmail = 0;
  const failed: SendOutstandingRemindersResult["failed"] = [];

  for (const row of rows) {
    const cents = outstandingCents(
      row.netOfCreditsAmount,
      row.total,
      settledByParent.get(row.id) ?? 0,
    );
    // Nothing left to collect — never send a reminder for it.
    if (cents <= 0) continue;

    const email = row.customerEmail?.trim() ?? "";
    const number = row.formattedNumber ?? row.id;
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }
    const customer = row.customerName?.trim() || email;
    const result = await sendOutboundInvoiceByEmailOp(caller, {
      invoiceId: row.id,
      to: email,
      subject: format(copy.reminderSubject, { number, business }),
      body: format(copy.reminderBodyEmail, { customer, number, business }),
      attachWithholdingCertificate: Boolean(
        entity.withholdingCertificateKey && entity.attachWithholdingCertificate,
      ),
    });
    if (result.success) {
      sent += 1;
    } else {
      failed.push({ number, error: result.error });
    }
  }

  revalidatePath("/");
  revalidatePath("/money-in");
  revalidatePath("/outbound");
  return { sent, skippedNoEmail, failed };
}
