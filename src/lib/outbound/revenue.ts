import {
  and,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { documentLinks, outboundInvoices } from "@/db/schema";
import { sqlAmountInDisplayCurrency } from "@/lib/fx";

/**
 * Revenue booked by an outbound document, as a SQL aggregate.
 *
 * Tax invoices and invoice-receipts add their amount and credit notes
 * subtract theirs. Proformas and delivery notes contribute nothing because
 * nothing has been billed yet.
 *
 * Receipts are the subtle case. A קבלה issued against a tax invoice
 * (`references_document_id` set, the "Issue receipt for this invoice" flow)
 * records a *payment* of revenue that the parent invoice already booked —
 * counting it again reported one ₪1,475 sale as ₪2,725 of income, because
 * the invoice contributes its net ₪1,250 and the receipt its ₪1,475: a pure
 * receipt is issued at 0% VAT by construction (see `documents/vat.ts`), so
 * its `subtotal` column holds the gross amount, not a net one. The link is
 * the same one `collections-actions` uses to net receipts out of the open
 * balance; revenue now honours it too.
 *
 * A standalone receipt — no parent invoice — is still counted: for a seller
 * who issues one, it is the only record of the sale, and dropping it would
 * erase real income. It books gross rather than net, which is inherent to a
 * document that carries no VAT breakdown.
 *
 * Callers pass the per-row amount to sum, which lets each one decide how the
 * column is prepared: FX-converted to a display currency, or raw `subtotal`
 * where the caller converts after grouping by currency.
 */
export function revenueSumExpr(amount: SQL): SQL<number> {
  return sql<number>`
    coalesce(sum(
      case
        when ${outboundInvoices.documentType} in ('TAX_INVOICE','TAX_INVOICE_RECEIPT')
          then ${amount}
        when ${outboundInvoices.documentType} = 'RECEIPT'
          and ${outboundInvoices.referencesDocumentId} is null
          then ${amount}
        when ${outboundInvoices.documentType} = 'CREDIT_INVOICE'
          then -abs(${amount})
        else 0
      end
    ), 0)::float`;
}

export interface IssuedIncomePeriod {
  timeRange?: "allTime" | "last12Months" | "year";
  year?: number | null;
  months?: number[];
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface IssuedIncomeSummary {
  /** Gross income in the display currency, after credit notes. */
  total: number;
  documentCount: number;
  byMonth: { month: string; total: number }[];
}

function last12MonthsStartDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().split("T")[0];
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Income from documents this business issued, for the profit view.
 *
 * Uses the gross `total` (what the customer was billed), in the viewer's
 * display currency, so it lines up with uploaded expense amounts.
 *
 * A credit note is stored as a negative total and always deducts its
 * magnitude. A full credit also voids the original;
 * that original is still included, so the credit is the single deduction
 * and the pair nets to zero. Dropping the voided original as well would
 * subtract the sale twice. A draft cancelled after a SHAAM refusal never
 * became a sale, so it stays out.
 */
export async function sumIssuedIncome(
  businessEntityId: string,
  displayCurrency: string,
  filters: IssuedIncomePeriod = {},
): Promise<IssuedIncomeSummary> {
  const displayAmt = sqlAmountInDisplayCurrency(
    sql`coalesce(${outboundInvoices.total}::numeric, 0)`,
    displayCurrency,
    outboundInvoices.currency,
  );

  const fullyCredited = exists(
    db
      .select({ id: documentLinks.id })
      .from(documentLinks)
      .where(
        and(
          eq(documentLinks.toDocumentId, outboundInvoices.id),
          eq(documentLinks.linkType, "CREDIT_REVERSES"),
        ),
      ),
  );

  const conditions: SQL[] = [
    eq(outboundInvoices.businessEntityId, businessEntityId),
    isNull(outboundInvoices.deletedAt),
    or(
      inArray(outboundInvoices.status, ["issued", "sent", "paid"]),
      and(eq(outboundInvoices.status, "voided"), fullyCredited),
    )!,
  ];

  if (filters.timeRange === "last12Months") {
    conditions.push(gte(outboundInvoices.invoiceDate, last12MonthsStartDate()));
  }
  if (filters.year) {
    conditions.push(
      sql`extract(year from ${outboundInvoices.invoiceDate}::date) = ${filters.year}`,
    );
  }
  if (filters.months && filters.months.length > 0) {
    conditions.push(
      inArray(
        sql<number>`extract(month from ${outboundInvoices.invoiceDate}::date)::int`,
        filters.months,
      ),
    );
  }
  if (filters.dateFrom) {
    conditions.push(gte(outboundInvoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(outboundInvoices.invoiceDate, filters.dateTo));
  }

  const monthBucketSql = sql<string>`to_char(${outboundInvoices.invoiceDate}::date, 'YYYY-MM')`;
  const contributing = sql`${outboundInvoices.documentType} in ('TAX_INVOICE','TAX_INVOICE_RECEIPT','CREDIT_INVOICE') or (${outboundInvoices.documentType} = 'RECEIPT' and ${outboundInvoices.referencesDocumentId} is null)`;

  const rows = await db
    .select({
      month: monthBucketSql,
      total: revenueSumExpr(displayAmt),
      documentCount: sql<number>`count(*) filter (where ${contributing})::int`,
    })
    .from(outboundInvoices)
    .where(and(...conditions))
    .groupBy(monthBucketSql);

  const byMonth = rows
    .map((row) => ({
      month: row.month,
      total: roundMoney(Number(row.total) || 0),
      documentCount: Number(row.documentCount) || 0,
    }))
    .filter((row) => row.total !== 0 || row.documentCount !== 0);

  return {
    total: roundMoney(byMonth.reduce((sum, row) => sum + row.total, 0)),
    documentCount: byMonth.reduce((sum, row) => sum + row.documentCount, 0),
    byMonth,
  };
}
