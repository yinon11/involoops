"use server";

/**
 * Server actions for the Tax Estimation Dashboard.
 *
 * Queries are split into two passes:
 *   1. Outbound invoices — VAT collected + gross revenue (ex-VAT), grouped by month.
 *   2. Inbound invoices  — VAT paid (adjusted by vatCreditPercent) + total expenses,
 *      grouped by month. Only `approved` expense-type rows with a non-null
 *      invoiceDate are included.
 *
 * Tax computation (brackets, BL rates, depreciation) lives in the pure
 * utility module `../components/tax-estimates/tax-calculations.ts` so the
 * client can re-run estimates in the browser when the user changes inputs
 * without a server round-trip.
 */

import { auth } from "@/auth";
import { db } from "@/db";
import { customers, invoices, outboundInvoices, taxEstimateInputs } from "@/db/schema";
import { and, eq, inArray, isNull, isNotNull, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { revalidatePath } from "next/cache";
import { isSelfEmployedEntityType } from "@/features/generator/components/tax-estimates/tax-calculations";
import type { FixedAsset } from "@/db/schema/tax-estimate-inputs";
import { requireActorUserId as requireUserId } from "@/lib/team/enforce";
import {
  convertAmountBetweenCurrencies,
  sqlAmountInDisplayCurrency,
} from "@/lib/fx";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { withholdingAmountOf } from "@/lib/documents/payments";
import { revenueSumExpr } from "@/lib/outbound/revenue";

// ─── Public types ────────────────────────────────────────────────────────────

export interface MonthlyTaxRow {
  month: number; // 1–12
  vatCollected: number;
  vatPaid: number;
  vatDue: number;
  grossRevenue: number;
  totalExpenses: number;
}

export interface TaxEstimationRawData {
  year: number;
  monthly: MonthlyTaxRow[]; // always 12 entries, months 1–12
  currency: string;
  isSelfEmployed: boolean;
  entityType: string | null;
  inputs: {
    taxCreditPoints: number;
    monthlyPayrollCost: number;
    hasInventory: boolean;
    fixedAssets: FixedAsset[];
  };
}

// ─── Document types that generate VAT liability ──────────────────────────────

const VAT_CHARGING_DOC_TYPES = ["TAX_INVOICE", "TAX_INVOICE_RECEIPT"] as const;

/** Revenue-generating document types (ex credit notes, proformas, delivery notes). */
const REVENUE_DOC_TYPES = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
  "RECEIPT",
] as const;

// ─── Main action ─────────────────────────────────────────────────────────────

/**
 * Fetch raw monthly aggregates and user inputs for the Tax Estimation Dashboard.
 *
 * Returns pre-filled 12-month arrays (all zeros for months with no activity)
 * so the client can always render a full-year chart without special-casing.
 */
export async function getTaxEstimationData(
  year?: number,
  options?: { convertToDisplayCurrency?: boolean },
): Promise<TaxEstimationRawData> {
  const userId = await requireUserId("view_outbound");
  const taxYear = year ?? new Date().getFullYear();
  // Every row is converted to one currency before it is summed. Which one
  // depends on the caller: Home reports in Settings → Dashboard Currency,
  // while the tax-estimate page normalises to ILS, because the figures feed
  // Israeli bracket / Bituach Leumi calculations that are statutory ILS.
  //
  // The page used to skip conversion entirely and label the result with
  // whichever currency appeared most often that year — which added shekels
  // to dollars and printed the total under a single symbol.
  const targetCurrency = options?.convertToDisplayCurrency
    ? await getUserDisplayCurrency(userId)
    : "ILS";

  const asDisplay = (amount: SQL, sourceCurrency: SQLWrapper): SQL =>
    sqlAmountInDisplayCurrency(amount, targetCurrency, sourceCurrency);

  const [entity, inputRow] = await Promise.all([
    getBusinessEntityForUserOrNull(userId),
    db.query.taxEstimateInputs.findFirst({
      where: and(
        eq(taxEstimateInputs.userId, userId),
        eq(taxEstimateInputs.year, taxYear),
      ),
    }),
  ]);

  const defaultInputs = {
    taxCreditPoints: 2.25,
    monthlyPayrollCost: 0,
    hasInventory: false,
    fixedAssets: [] as FixedAsset[],
  };

  const inputs = inputRow
    ? {
        taxCreditPoints: Number(inputRow.taxCreditPoints),
        monthlyPayrollCost: Number(inputRow.monthlyPayrollCost),
        hasInventory: inputRow.hasInventory,
        fixedAssets: (inputRow.fixedAssets ?? []) as FixedAsset[],
      }
    : defaultInputs;

  // Empty result when no business entity is set up yet
  const isSelfEmployed = isSelfEmployedEntityType(entity?.entityType ?? null);
  const emptyMonthly: MonthlyTaxRow[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    vatCollected: 0,
    vatPaid: 0,
    vatDue: 0,
    grossRevenue: 0,
    totalExpenses: 0,
  }));

  if (!entity) {
    return {
      year: taxYear,
      monthly: emptyMonthly,
      currency: targetCurrency,
      isSelfEmployed,
      entityType: null,
      inputs,
    };
  }

  const outboundVat = asDisplay(
    sql`coalesce(${outboundInvoices.vatAmount}::numeric, 0)`,
    outboundInvoices.currency,
  );
  const outboundSubtotal = asDisplay(
    sql`coalesce(${outboundInvoices.subtotal}::numeric, 0)`,
    outboundInvoices.currency,
  );
  const inboundVat = asDisplay(
    sql`coalesce(${invoices.vatAmount}::numeric, 0) * coalesce(${invoices.vatCreditPercent}, 100) / 100.0`,
    invoices.currency,
  );
  const inboundExpense = asDisplay(
    sql`coalesce(${invoices.amountWithoutVat}::numeric, ${invoices.amount}::numeric, 0)`,
    invoices.currency,
  );

  // ── Outbound aggregates ──────────────────────────────────────────────────
  // Single pass: extract month, sum vatAmount (negated for CREDIT_INVOICE)
  // and subtotal for revenue documents.
  //
  // VAT: only TAX_INVOICE + TAX_INVOICE_RECEIPT contribute.
  // Revenue: `revenueSumExpr` — same set, plus receipts that settle no
  // invoice of their own (a receipt against a tax invoice is a payment of
  // revenue already booked, not a second sale).
  // Credit invoices reduce both VAT and revenue with a CASE sign-flip.
  //
  // `status != 'voided'` and `deleted_at IS NULL` guards.

  const outboundRows = await db
    .select({
      month: sql<number>`extract(month from ${outboundInvoices.invoiceDate})::int`,
      vatCollected: sql<number>`
        coalesce(sum(
          case
            when ${outboundInvoices.documentType} in ('TAX_INVOICE','TAX_INVOICE_RECEIPT')
              then ${outboundVat}
            when ${outboundInvoices.documentType} = 'CREDIT_INVOICE'
              then -(${outboundVat})
            else 0
          end
        ), 0)::float`,
      grossRevenue: revenueSumExpr(outboundSubtotal),
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, entity.id),
        inArray(outboundInvoices.status, ["issued", "sent", "paid"]),
        isNull(outboundInvoices.deletedAt),
        sql`extract(year from ${outboundInvoices.invoiceDate}) = ${taxYear}`,
        inArray(outboundInvoices.documentType, [
          ...VAT_CHARGING_DOC_TYPES,
          ...REVENUE_DOC_TYPES,
          "CREDIT_INVOICE",
        ]),
      ),
    )
    .groupBy(
      sql`extract(month from ${outboundInvoices.invoiceDate})`,
    );

  // ── Inbound aggregates ───────────────────────────────────────────────────
  // Only `approved` expense invoices with a non-null invoiceDate.
  // VAT deduction is adjusted by vatCreditPercent (default 100 = full credit).

  const inboundRows = await db
    .select({
      month: sql<number>`extract(month from ${invoices.invoiceDate})::int`,
      vatPaid: sql<number>`
        coalesce(sum(${inboundVat}), 0)::float`,
      totalExpenses: sql<number>`
        coalesce(sum(${inboundExpense}), 0)::float`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        eq(invoices.status, "approved"),
        eq(invoices.type, "expense"),
        isNotNull(invoices.invoiceDate),
        sql`extract(year from ${invoices.invoiceDate}) = ${taxYear}`,
      ),
    )
    .groupBy(sql`extract(month from ${invoices.invoiceDate})`);

  // Every figure above is already in `targetCurrency`, so the label is just
  // that — no need to guess from the documents.
  const currency = targetCurrency;

  // ── Merge into 12-slot array ─────────────────────────────────────────────
  const outboundByMonth = new Map(outboundRows.map((r) => [r.month, r]));
  const inboundByMonth = new Map(inboundRows.map((r) => [r.month, r]));

  const monthly: MonthlyTaxRow[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const ob = outboundByMonth.get(m);
    const ib = inboundByMonth.get(m);
    const vatCollected = ob?.vatCollected ?? 0;
    const vatPaid = ib?.vatPaid ?? 0;
    return {
      month: m,
      vatCollected,
      vatPaid,
      vatDue: vatCollected - vatPaid,
      grossRevenue: ob?.grossRevenue ?? 0,
      totalExpenses: ib?.totalExpenses ?? 0,
    };
  });

  return {
    year: taxYear,
    monthly,
    currency,
    isSelfEmployed,
    entityType: entity.entityType,
    inputs,
  };
}

// ─── Monthly revenue summary (home page) ────────────────────────────────────

export interface MonthlyRevenueSummary {
  thisMonth: number;
  lastMonth: number;
  currency: string;
}

/**
 * Sum non-voided outbound revenue (subtotal of revenue document types,
 * minus credit notes) for the current and previous calendar months.
 * Returns zeros when the user has no business entity yet.
 */
export async function getMonthlyRevenueSummary(): Promise<MonthlyRevenueSummary> {
  const session = await auth();
  if (!session?.user?.id) {
    return { thisMonth: 0, lastMonth: 0, currency: "ILS" };
  }
  const displayCurrency = await getUserDisplayCurrency(session.user.id);
  const entity = await getBusinessEntityForUserOrNull(session.user.id);
  if (!entity) return { thisMonth: 0, lastMonth: 0, currency: displayCurrency };

  const now = new Date();
  const startThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const startLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endLast = startThis;
  const endThis = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const rows = await db
    .select({
      bucket: sql<string>`case
        when ${outboundInvoices.invoiceDate} >= ${startThis.toISOString()}::date
          and ${outboundInvoices.invoiceDate} < ${endThis.toISOString()}::date then 'this'
        when ${outboundInvoices.invoiceDate} >= ${startLast.toISOString()}::date
          and ${outboundInvoices.invoiceDate} < ${endLast.toISOString()}::date then 'last'
        else 'other' end`,
      amount: revenueSumExpr(
        sql`coalesce(${outboundInvoices.subtotal}::numeric, 0)`,
      ),
      currency: outboundInvoices.currency,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, entity.id),
        ne(outboundInvoices.status, "voided"),
        isNull(outboundInvoices.deletedAt),
        sql`${outboundInvoices.invoiceDate} >= ${startLast.toISOString()}::date`,
        sql`${outboundInvoices.invoiceDate} < ${endThis.toISOString()}::date`,
      ),
    )
    .groupBy(
      sql`case
        when ${outboundInvoices.invoiceDate} >= ${startThis.toISOString()}::date
          and ${outboundInvoices.invoiceDate} < ${endThis.toISOString()}::date then 'this'
        when ${outboundInvoices.invoiceDate} >= ${startLast.toISOString()}::date
          and ${outboundInvoices.invoiceDate} < ${endLast.toISOString()}::date then 'last'
        else 'other' end`,
      outboundInvoices.currency,
    );

  let thisMonth = 0;
  let lastMonth = 0;
  for (const r of rows) {
    const converted = convertAmountBetweenCurrencies(
      Number(r.amount) || 0,
      r.currency ?? "ILS",
      displayCurrency,
    );
    if (r.bucket === "this") thisMonth += converted;
    else if (r.bucket === "last") lastMonth += converted;
  }

  return { thisMonth, lastMonth, currency: displayCurrency };
}

// ─── Save inputs ─────────────────────────────────────────────────────────────

export interface SaveTaxEstimateInputsPayload {
  year: number;
  taxCreditPoints: number;
  monthlyPayrollCost: number;
  hasInventory: boolean;
  fixedAssets: FixedAsset[];
}

/**
 * Upsert the user-supplied tax estimate inputs for a given year.
 * Returns the saved row.
 */
export async function saveTaxEstimateInputs(
  payload: SaveTaxEstimateInputsPayload,
) {
  const userId = await requireUserId();

  const [row] = await db
    .insert(taxEstimateInputs)
    .values({
      userId,
      year: payload.year,
      taxCreditPoints: String(payload.taxCreditPoints),
      monthlyPayrollCost: String(payload.monthlyPayrollCost),
      hasInventory: payload.hasInventory,
      fixedAssets: payload.fixedAssets,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [taxEstimateInputs.userId, taxEstimateInputs.year],
      set: {
        taxCreditPoints: String(payload.taxCreditPoints),
        monthlyPayrollCost: String(payload.monthlyPayrollCost),
        hasInventory: payload.hasInventory,
        fixedAssets: payload.fixedAssets,
        updatedAt: new Date(),
      },
    })
    .returning();

  revalidatePath("/outbound/tax-estimates");

  // Refresh recommendations in background — do not await.
  import("@/features/generator/lib/recommendation-engine")
    .then(({ generateRecommendations }) => generateRecommendations(userId))
    .catch(console.error);

  return row;
}

// ─── Withholding-tax reconciliation (ניכוי מס במקור) ─────────────────────────

export interface WithholdingCustomerRow {
  customerId: string | null;
  customerName: string;
  customerTaxId: string | null;
  receiptCount: number;
  gross: number;
  withheld: number;
  received: number;
}

export interface WithholdingReconciliation {
  year: number;
  currency: string;
  rows: WithholdingCustomerRow[];
  totalGross: number;
  totalWithheld: number;
  totalReceived: number;
  /** True when at least one receipt in the year carried withholding. */
  hasWithholding: boolean;
}

/**
 * Per-customer ניכוי מס במקור totals for a tax year — the figures to check
 * against the טופס 857 each customer issues in the following March.
 *
 * Withholding is not a stored column: the printed receipt carries the gross
 * and the withheld portion is one of the payment entries that closes it, so
 * the split is derived through `withholdingAmountOf`. Aggregating in JS
 * rather than SQL keeps that derivation in one place; receipt volume per
 * year is small enough that the round-trip is not worth a jsonb unnest.
 *
 * Amounts are converted to a single currency so the totals add up. Customers
 * with no withholding in the year are omitted.
 */
export async function getWithholdingReconciliation(
  year?: number,
): Promise<WithholdingReconciliation> {
  const userId = await requireUserId("view_outbound");
  const taxYear = year ?? new Date().getFullYear();
  const entity = await getBusinessEntityForUserOrNull(userId);
  const currency = await getUserDisplayCurrency(userId);

  const empty: WithholdingReconciliation = {
    year: taxYear,
    currency,
    rows: [],
    totalGross: 0,
    totalWithheld: 0,
    totalReceived: 0,
    hasWithholding: false,
  };
  if (!entity) return empty;

  const rows = await db
    .select({
      customerId: outboundInvoices.customerId,
      customerName: customers.name,
      customerTaxId: customers.taxId,
      total: outboundInvoices.total,
      currency: outboundInvoices.currency,
      payments: outboundInvoices.payments,
    })
    .from(outboundInvoices)
    .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
    .where(
      and(
        eq(outboundInvoices.businessEntityId, entity.id),
        inArray(outboundInvoices.documentType, ["RECEIPT", "TAX_INVOICE_RECEIPT"]),
        inArray(outboundInvoices.status, ["issued", "sent", "paid"]),
        isNull(outboundInvoices.deletedAt),
        sql`extract(year from ${outboundInvoices.invoiceDate}) = ${taxYear}`,
      ),
    );

  // Group on the customer id; receipts with no linked customer collapse into
  // one "—" bucket rather than being dropped.
  const byCustomer = new Map<string, WithholdingCustomerRow>();
  for (const r of rows) {
    const withheldRaw = withholdingAmountOf(r.payments);
    if (withheldRaw <= 0) continue;

    const from = r.currency ?? "ILS";
    const withheld = convertAmountBetweenCurrencies(withheldRaw, from, currency);
    const gross = convertAmountBetweenCurrencies(Number(r.total), from, currency);

    const key = r.customerId ?? "";
    const existing = byCustomer.get(key);
    if (existing) {
      existing.receiptCount += 1;
      existing.gross += gross;
      existing.withheld += withheld;
    } else {
      byCustomer.set(key, {
        customerId: r.customerId,
        customerName: r.customerName ?? "—",
        customerTaxId: r.customerTaxId ?? null,
        receiptCount: 1,
        gross,
        withheld,
        received: 0,
      });
    }
  }

  const result = [...byCustomer.values()]
    .map((row) => ({
      ...row,
      gross: round2(row.gross),
      withheld: round2(row.withheld),
      received: round2(row.gross - row.withheld),
    }))
    .sort((a, b) => b.withheld - a.withheld);

  return {
    year: taxYear,
    currency,
    rows: result,
    totalGross: round2(result.reduce((s, r) => s + r.gross, 0)),
    totalWithheld: round2(result.reduce((s, r) => s + r.withheld, 0)),
    totalReceived: round2(result.reduce((s, r) => s + r.received, 0)),
    hasWithholding: result.length > 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
