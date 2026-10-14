import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, invoices, outboundInvoices, vendors } from "@/db/schema";
import { getUserDisplayCurrency } from "@/lib/display-currency";
import { sqlAmountInDisplayCurrency } from "@/lib/fx";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { sumIssuedIncome } from "@/lib/outbound/revenue";
import { listDuplicateGroups } from "@/lib/invoices/duplicate-groups";

export interface DashboardSummary {
  currency: string;
  month: string;
  money_in: number;
  money_out: number;
  previous_money_in: number;
  previous_money_out: number;
  net: number;
  year_money_in: number;
  year_money_out: number;
  pending_count: number;
  duplicate_count: number;
  unpaid_count: number;
  unpaid_total: number;
  /** Last six calendar months including the current one, oldest first. */
  months: { month: string; money_in: number; money_out: number }[];
  top_vendors: { id: string | null; name: string; total: number }[];
  top_customers: { name: string; total: number; count: number }[];
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The home-page numbers: issued income against approved expenses, in the
 * user's display currency. Same revenue rule as the website (`sumIssuedIncome`).
 */
export async function dashboardForUser(userId: string): Promise<DashboardSummary> {
  const now = new Date();
  const startThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // The chart window: six calendar months including the current one.
  const startWindow = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const endThis = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const year = now.getFullYear();
  const currency = await getUserDisplayCurrency(userId);
  const entity = await getBusinessEntityForUserOrNull(userId);

  const expenseAmt = sqlAmountInDisplayCurrency(
    sql`${invoices.amount}::numeric`,
    currency,
  );
  const monthBucket = sql<string>`to_char(${invoices.invoiceDate}::date, 'YYYY-MM')`;

  const [incomeWindow, incomeYear, expenseMonths, expenseYear, pendingRow, duplicates, unpaid] =
    await Promise.all([
      entity
        ? sumIssuedIncome(entity.id, currency, {
            dateFrom: ymd(startWindow),
            dateTo: ymd(endThis),
          })
        : Promise.resolve({ total: 0, documentCount: 0, byMonth: [] }),
      entity
        ? sumIssuedIncome(entity.id, currency, { year })
        : Promise.resolve({ total: 0, documentCount: 0, byMonth: [] }),
      db
        .select({
          month: monthBucket,
          total: sql<number>`coalesce(sum(${expenseAmt}), 0)::float`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.userId, userId),
            eq(invoices.status, "approved"),
            eq(invoices.type, "expense"),
            isNotNull(invoices.invoiceDate),
            gte(invoices.invoiceDate, ymd(startWindow)),
            lte(invoices.invoiceDate, ymd(endThis)),
          ),
        )
        .groupBy(monthBucket),
      db
        .select({
          total: sql<number>`coalesce(sum(${expenseAmt}), 0)::float`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.userId, userId),
            eq(invoices.status, "approved"),
            eq(invoices.type, "expense"),
            isNotNull(invoices.invoiceDate),
            sql`extract(year from ${invoices.invoiceDate}::date) = ${year}`,
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(and(eq(invoices.userId, userId), eq(invoices.status, "pending"))),
      listDuplicateGroups(userId),
      entity ? unpaidIssued(entity.id, currency) : Promise.resolve({ count: 0, total: 0, customers: [] }),
    ]);

  const thisKey = monthKey(startThis);
  const prevKey = monthKey(startPrev);
  const moneyIn = incomeWindow.byMonth.find((row) => row.month === thisKey)?.total ?? 0;
  const previousMoneyIn = incomeWindow.byMonth.find((row) => row.month === prevKey)?.total ?? 0;
  const moneyOut = Number(expenseMonths.find((row) => row.month === thisKey)?.total ?? 0);
  const previousMoneyOut = Number(expenseMonths.find((row) => row.month === prevKey)?.total ?? 0);

  const months = Array.from({ length: 6 }, (_, index) => {
    const key = monthKey(new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
    return {
      month: key,
      money_in: roundMoney(incomeWindow.byMonth.find((row) => row.month === key)?.total ?? 0),
      money_out: roundMoney(Number(expenseMonths.find((row) => row.month === key)?.total ?? 0)),
    };
  });

  const topVendors = await topExpenseVendors(userId, currency, year);

  return {
    currency,
    month: thisKey,
    money_in: roundMoney(moneyIn),
    money_out: roundMoney(moneyOut),
    previous_money_in: roundMoney(previousMoneyIn),
    previous_money_out: roundMoney(previousMoneyOut),
    net: roundMoney(moneyIn - moneyOut),
    year_money_in: roundMoney(incomeYear.total),
    year_money_out: roundMoney(Number(expenseYear[0]?.total ?? 0)),
    pending_count: Number(pendingRow[0]?.count ?? 0),
    duplicate_count: duplicates.length,
    unpaid_count: unpaid.count,
    unpaid_total: roundMoney(unpaid.total),
    months,
    top_vendors: topVendors,
    top_customers: unpaid.customers,
  };
}

async function unpaidIssued(businessEntityId: string, currency: string) {
  const displayAmt = sqlAmountInDisplayCurrency(
    sql`coalesce(${outboundInvoices.total}::numeric, 0)`,
    currency,
    outboundInvoices.currency,
  );
  const rows = await db
    .select({
      name: customers.name,
      total: sql<number>`coalesce(sum(${displayAmt}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(outboundInvoices)
    .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
    .where(
      and(
        eq(outboundInvoices.businessEntityId, businessEntityId),
        isNull(outboundInvoices.deletedAt),
        inArray(outboundInvoices.status, ["issued", "sent"]),
      ),
    )
    .groupBy(customers.name)
    .orderBy(desc(sql`sum(${displayAmt})`))
    .limit(5);

  const [totals] = await db
    .select({
      total: sql<number>`coalesce(sum(${displayAmt}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, businessEntityId),
        isNull(outboundInvoices.deletedAt),
        inArray(outboundInvoices.status, ["issued", "sent"]),
      ),
    );

  return {
    count: Number(totals?.count ?? 0),
    total: Number(totals?.total ?? 0),
    customers: rows.map((row) => ({
      name: row.name ?? "—",
      total: roundMoney(Number(row.total) || 0),
      count: Number(row.count) || 0,
    })),
  };
}

async function topExpenseVendors(userId: string, currency: string, year: number) {
  const displayAmt = sqlAmountInDisplayCurrency(
    sql`${invoices.amount}::numeric`,
    currency,
  );
  const rows = await db
    .select({
      id: invoices.vendorId,
      name: sql<string>`coalesce(${vendors.name}, ${invoices.suggestedVendorName}, '—')`,
      total: sql<number>`coalesce(sum(${displayAmt}), 0)::float`,
    })
    .from(invoices)
    .leftJoin(vendors, and(eq(invoices.vendorId, vendors.id), eq(vendors.userId, userId)))
    .where(
      and(
        eq(invoices.userId, userId),
        eq(invoices.status, "approved"),
        eq(invoices.type, "expense"),
        isNotNull(invoices.invoiceDate),
        sql`extract(year from ${invoices.invoiceDate}::date) = ${year}`,
      ),
    )
    .groupBy(invoices.vendorId, vendors.name, invoices.suggestedVendorName)
    .orderBy(desc(sql`sum(${displayAmt})`))
    .limit(5);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    total: roundMoney(Number(row.total) || 0),
  }));
}
