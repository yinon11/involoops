import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { outboundInvoices } from "@/db/schema";
import type { DocumentType } from "@/lib/documents/types";
import { israelDateString } from "@/lib/datetime/today";

type IssueDateTx = {
  select: typeof import("@/db").db.select;
};

/**
 * The date printed on a document is the Israel civil day it is issued.
 * Payment and value dates are not rewritten to this day.
 */
export function printedDateForIssue(now: Date = new Date()): string {
  return israelDateString(now);
}

/** True when the printed date would precede the previous document in the series. */
export function printedDatePrecedesPrevious(
  printedDate: string,
  previousPrintedDate: string | null,
): boolean {
  return previousPrintedDate != null && printedDate < previousPrintedDate;
}

export class PrintedDateOrderError extends Error {
  readonly printedDate: string;
  readonly previousDate: string;
  readonly previousNumber: string | null;

  constructor(printedDate: string, previousDate: string, previousNumber: string | null) {
    super(
      `The document would be dated ${printedDate}, which is earlier than the previous document in this series (${previousNumber ?? "unnumbered"}, ${previousDate}).`,
    );
    this.name = "PrintedDateOrderError";
    this.printedDate = printedDate;
    this.previousDate = previousDate;
    this.previousNumber = previousNumber;
  }
}

/**
 * Refuse a printed date earlier than the latest numbered document of this
 * type for this entity. Payment dates and value dates are not compared.
 * Numbered rows include issued documents and credit notes (those stay
 * `draft` in status but already hold a series number). Historical rows
 * with no `printed_date` use `invoice_date`, which was the date printed
 * on them.
 */
export async function assertPrintedDateFollowsSeries(
  tx: IssueDateTx,
  params: {
    businessEntityId: string;
    documentType: DocumentType;
    printedDate: string;
    excludeDocumentId?: string;
  },
): Promise<void> {
  const filters = [
    eq(outboundInvoices.businessEntityId, params.businessEntityId),
    eq(outboundInvoices.documentType, params.documentType),
    isNull(outboundInvoices.deletedAt),
    isNotNull(outboundInvoices.sequenceNumber),
  ];
  if (params.excludeDocumentId) {
    filters.push(ne(outboundInvoices.id, params.excludeDocumentId));
  }
  const [previous] = await tx
    .select({
      printedDate: sql<string | null>`coalesce(${outboundInvoices.printedDate}, ${outboundInvoices.invoiceDate})`,
      formattedNumber: outboundInvoices.formattedNumber,
    })
    .from(outboundInvoices)
    .where(and(...filters))
    .orderBy(desc(outboundInvoices.sequenceNumber))
    .limit(1);
  const previousPrinted = previous?.printedDate ?? null;
  if (printedDatePrecedesPrevious(params.printedDate, previousPrinted)) {
    throw new PrintedDateOrderError(
      params.printedDate,
      previousPrinted ?? params.printedDate,
      previous?.formattedNumber ?? null,
    );
  }
}
