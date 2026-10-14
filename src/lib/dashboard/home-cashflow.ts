import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, outboundInvoices, vendors } from "@/db/schema";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { sqlAmountInDisplayCurrency } from "@/lib/fx";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { revenueSumExpr } from "@/lib/outbound/revenue";
import {
  chartSlots,
  homeWindow,
  type HomeRange,
  type HomeWindow,
} from "./home-window";

export interface HomeCashflowPoint {
  key: string;
  income: number;
  expense: number;
}

export interface HomeCashflowVendor {
  vendorId: string | null;
  vendorName: string | null;
  total: number;
}

export interface HomeCashflow {
  window: HomeWindow;
  currency: string;
  moneyIn: number;
  moneyOut: number;
  prevIn: number;
  prevOut: number;
  points: HomeCashflowPoint[];
  vendors: HomeCashflowVendor[];
}

const REVENUE_DOC_TYPES = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
  "RECEIPT",
  "CREDIT_INVOICE",
] as const;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function dateBounds(
  column: typeof invoices.invoiceDate | typeof outboundInvoices.invoiceDate,
  from: string | null,
  to: string | null,
) {
  const bounds = [];
  if (from) bounds.push(gte(column, from));
  if (to) bounds.push(lt(column, to));
  return bounds;
}

/**
 * Money in and money out for the home dashboard, on one window.
 *
 * Income is the pre-VAT subtotal of issued documents (credit notes subtract),
 * the same figure the current-month tile used to take from the tax estimate.
 * Expenses are approved, pre-VAT. Both are converted to the display currency
 * before they are added.
 */
export async function homeCashflow(
  userId: string,
  range: HomeRange,
  now = new Date(),
): Promise<HomeCashflow> {
  const window = homeWindow(range, now);
  const currency = await getUserDisplayCurrency(userId);
  const entity = await getBusinessEntityForUserOrNull(userId);

  const incomeAmt = sqlAmountInDisplayCurrency(
    sql`coalesce(${outboundInvoices.subtotal}::numeric, 0)`,
    currency,
    outboundInvoices.currency,
  );
  const expenseAmt = sqlAmountInDisplayCurrency(
    sql`coalesce(${invoices.amountWithoutVat}::numeric, ${invoices.amount}::numeric, 0)`,
    currency,
    invoices.currency,
  );
  const incomeBucket =
    window.grain === "day"
      ? sql<string>`to_char(${outboundInvoices.invoiceDate}::date, 'YYYY-MM-DD')`
      : sql<string>`to_char(${outboundInvoices.invoiceDate}::date, 'YYYY-MM')`;
  const expenseBucket =
    window.grain === "day"
      ? sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM-DD')`
      : sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;

  const incomeWhere = (from: string | null, to: string | null) =>
    and(
      entity ? eq(outboundInvoices.businessEntityId, entity.id) : sql`false`,
      inArray(outboundInvoices.status, ["issued", "sent", "paid"]),
      isNull(outboundInvoices.deletedAt),
      inArray(outboundInvoices.documentType, [...REVENUE_DOC_TYPES]),
      ...dateBounds(outboundInvoices.invoiceDate, from, to),
    );

  const expenseWhere = (from: string | null, to: string | null) =>
    and(
      eq(invoices.userId, userId),
      eq(invoices.status, "approved"),
      eq(invoices.type, "expense"),
      isNotNull(invoices.invoiceDate),
      ...dateBounds(invoices.invoiceDate, from, to),
    );

  const [incomeRows, expenseRows, prevIncomeRows, prevExpenseRows, vendorRows] =
    await Promise.all([
      entity
        ? db
            .select({
              bucket: incomeBucket,
              total: revenueSumExpr(incomeAmt),
            })
            .from(outboundInvoices)
            .where(incomeWhere(window.from, window.to))
            .groupBy(incomeBucket)
        : Promise.resolve([]),
      db
        .select({
          bucket: expenseBucket,
          total: sql<number>`coalesce(sum(${expenseAmt}), 0)::float`,
        })
        .from(invoices)
        .where(expenseWhere(window.from, window.to))
        .groupBy(expenseBucket),
      entity && window.prevFrom
        ? db
            .select({ total: revenueSumExpr(incomeAmt) })
            .from(outboundInvoices)
            .where(incomeWhere(window.prevFrom, window.prevTo))
        : Promise.resolve([]),
      window.prevFrom
        ? db
            .select({
              total: sql<number>`coalesce(sum(${expenseAmt}), 0)::float`,
            })
            .from(invoices)
            .where(expenseWhere(window.prevFrom, window.prevTo))
        : Promise.resolve([]),
      db
        .select({
          vendorId: invoices.vendorId,
          vendorName: vendors.name,
          total: sql<number>`coalesce(sum(${expenseAmt}), 0)::float`,
        })
        .from(invoices)
        .leftJoin(
          vendors,
          and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)),
        )
        .where(expenseWhere(window.from, window.to))
        .groupBy(invoices.vendorId, vendors.name)
        .orderBy(sql`sum(${expenseAmt}) desc`)
        .limit(5),
    ]);

  const incomeByBucket = new Map(
    incomeRows.map((row) => [row.bucket, Number(row.total) || 0]),
  );
  const expenseByBucket = new Map(
    expenseRows.map((row) => [row.bucket, Number(row.total) || 0]),
  );

  const slots = chartSlots(window);
  const keys =
    slots.length > 0
      ? slots
      : [...new Set([...incomeByBucket.keys(), ...expenseByBucket.keys()])].sort();

  const points = keys.map((key) => ({
    key,
    income: roundMoney(incomeByBucket.get(key) ?? 0),
    expense: roundMoney(expenseByBucket.get(key) ?? 0),
  }));

  const moneyIn = roundMoney(
    [...incomeByBucket.values()].reduce((sum, value) => sum + value, 0),
  );
  const moneyOut = roundMoney(
    [...expenseByBucket.values()].reduce((sum, value) => sum + value, 0),
  );

  return {
    window,
    currency,
    moneyIn,
    moneyOut,
    prevIn: roundMoney(Number(prevIncomeRows[0]?.total) || 0),
    prevOut: roundMoney(Number(prevExpenseRows[0]?.total) || 0),
    points,
    vendors: vendorRows.map((row) => ({
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      total: roundMoney(Number(row.total) || 0),
    })),
  };
}
