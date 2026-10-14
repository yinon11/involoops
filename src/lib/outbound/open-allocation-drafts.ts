import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, outboundInvoices } from "@/db/schema";

/**
 * A numbered draft the Tax Authority refused or has not decided on.
 * The number is spent, but the document is not a deal: it stays out of
 * income, PCN874, Hashavshevet and the uniform-structure file until the
 * seller chooses. The export of its month lists it so that month is not
 * mistaken for finished.
 */
export interface OpenAllocationDraft {
  id: string;
  formattedNumber: string;
  documentDate: string;
  customerName: string;
  total: string;
  currency: string;
  shaamStatus: "REJECTED" | "HELD";
}

export async function listOpenAllocationDrafts(params: {
  businessEntityId: string;
  /** Inclusive, YYYY-MM-DD. Matched on the date printed on the document. */
  periodStart: string;
  periodEnd: string;
}): Promise<OpenAllocationDraft[]> {
  const printed = sql`coalesce(${outboundInvoices.printedDate}, ${outboundInvoices.invoiceDate})`;
  const rows = await db
    .select({
      id: outboundInvoices.id,
      formattedNumber: outboundInvoices.formattedNumber,
      printedDate: outboundInvoices.printedDate,
      invoiceDate: outboundInvoices.invoiceDate,
      total: outboundInvoices.total,
      currency: outboundInvoices.currency,
      shaamStatus: outboundInvoices.shaamStatus,
      customerName: customers.name,
    })
    .from(outboundInvoices)
    .leftJoin(customers, eq(customers.id, outboundInvoices.customerId))
    .where(
      and(
        eq(outboundInvoices.businessEntityId, params.businessEntityId),
        eq(outboundInvoices.status, "draft"),
        isNotNull(outboundInvoices.formattedNumber),
        inArray(outboundInvoices.shaamStatus, ["REJECTED", "HELD"]),
        isNull(outboundInvoices.deletedAt),
        sql`${printed} >= ${params.periodStart}`,
        sql`${printed} <= ${params.periodEnd}`,
      ),
    )
    .orderBy(asc(printed), asc(outboundInvoices.sequenceNumber));

  return rows.flatMap((row) => {
    if (row.formattedNumber == null) return [];
    if (row.shaamStatus !== "REJECTED" && row.shaamStatus !== "HELD") return [];
    return [
      {
        id: row.id,
        formattedNumber: row.formattedNumber,
        documentDate: String(row.printedDate ?? row.invoiceDate),
        customerName: row.customerName ?? "",
        total: row.total,
        currency: row.currency ?? "ILS",
        shaamStatus: row.shaamStatus,
      },
    ];
  });
}
