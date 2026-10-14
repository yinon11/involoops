import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessEntities, customers, outboundInvoices } from "@/db/schema";
import { DOCUMENT_TYPE_PREFIX, type DocumentType } from "@/lib/documents/types";
import { toStatutoryIlsAmounts } from "@/lib/outbound/statutory-ils-amounts";
import { isValidIsraeliVatNumber } from "@/lib/uniform-structure/vat-checksum";
import { buildPcn874, Pcn874Error, type Pcn874File, type Pcn874Sale } from "./build";

/** The documents that are sales for VAT: tax invoices and their credits. */
const SALES_DOCUMENT_TYPES = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
  "CREDIT_INVOICE",
] as const satisfies readonly DocumentType[];

/** A document reported without something the reader should know about. */
export interface Pcn874Note {
  formattedNumber: string;
  kind: "no_customer_number" | "allocation_pending";
}

function monthBounds(month: string): { first: string; last: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new Pcn874Error(`Bad month "${month}" — expected YYYY-MM.`);
  }
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * The issued sales documents of one month, as PCN874 entries.
 *
 * Included: every tax invoice, invoice-receipt and credit note that was
 * issued, by the date printed on it — also one later voided by a credit
 * note, since the credit note is reported against it. Excluded: drafts,
 * and documents cancelled after an ITA refusal (`CANCELLED_AFTER_REJECTION`
 * — the cancel alternative, or the original of a reverse charge after a
 * refusal): their numbers were spent, but no invoice was ever issued.
 *
 * Amounts in ILS at the rate frozen on the document. The customer number
 * is read from the customer record, as the Uniform Structure export does.
 */
export async function loadPcn874Sales(params: {
  businessEntityId: string;
  month: string;
}): Promise<{ sales: Pcn874Sale[]; notes: Pcn874Note[] }> {
  const { first, last } = monthBounds(params.month);
  const printed = sql`coalesce(${outboundInvoices.printedDate}, ${outboundInvoices.invoiceDate})`;
  const rows = await db
    .select({
      id: outboundInvoices.id,
      documentType: outboundInvoices.documentType,
      formattedNumber: outboundInvoices.formattedNumber,
      printedDate: outboundInvoices.printedDate,
      invoiceDate: outboundInvoices.invoiceDate,
      customerId: outboundInvoices.customerId,
      currency: outboundInvoices.currency,
      subtotal: outboundInvoices.subtotal,
      vatAmount: outboundInvoices.vatAmount,
      total: outboundInvoices.total,
      fxRateToIls: outboundInvoices.fxRateToIls,
      allocationNumber: outboundInvoices.allocationNumber,
      shaamStatus: outboundInvoices.shaamStatus,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, params.businessEntityId),
        inArray(outboundInvoices.documentType, [...SALES_DOCUMENT_TYPES]),
        isNotNull(outboundInvoices.formattedNumber),
        ne(outboundInvoices.status, "draft"),
        isNull(outboundInvoices.deletedAt),
        sql`${outboundInvoices.shaamStatus} IS DISTINCT FROM 'CANCELLED_AFTER_REJECTION'`,
        sql`${printed} >= ${first}`,
        sql`${printed} <= ${last}`,
      ),
    )
    .orderBy(asc(printed), asc(outboundInvoices.sequenceNumber));

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is string => !!v))];
  const customerRows = customerIds.length
    ? await db
        .select({ id: customers.id, taxId: customers.taxId })
        .from(customers)
        .where(inArray(customers.id, customerIds))
    : [];
  const taxIdById = new Map(customerRows.map((c) => [c.id, c.taxId?.trim() ?? ""]));

  const sales: Pcn874Sale[] = [];
  const notes: Pcn874Note[] = [];
  for (const r of rows) {
    const formattedNumber = r.formattedNumber as string;
    const taxId = r.customerId ? (taxIdById.get(r.customerId) ?? "") : "";
    const validTaxId = /^\d{9}$/.test(taxId) && isValidIsraeliVatNumber(taxId);
    if (!validTaxId) notes.push({ formattedNumber, kind: "no_customer_number" });
    if (
      !r.allocationNumber &&
      (r.shaamStatus === "PENDING" || r.shaamStatus === "OUTAGE_ISSUED" || r.shaamStatus === "UNRESOLVED")
    ) {
      notes.push({ formattedNumber, kind: "allocation_pending" });
    }
    // Issued foreign-currency documents always carry their frozen rate;
    // without one this throws rather than report invented ILS figures.
    const ils = toStatutoryIlsAmounts(r);
    sales.push({
      documentId: r.id,
      formattedNumber,
      seriesPrefix: DOCUMENT_TYPE_PREFIX[r.documentType as DocumentType],
      invoiceDate: String(r.printedDate ?? r.invoiceDate),
      customerVatNumber: validTaxId ? taxId : null,
      preVatIls: ils.subtotal,
      vatIls: ils.vatAmount,
      isCredit: r.documentType === "CREDIT_INVOICE",
      allocationNumber: r.allocationNumber,
    });
  }
  return { sales, notes };
}

/** The whole file for one month, plus what the seller should check. */
export async function generatePcn874(params: {
  businessEntityId: string;
  month: string;
  generatedOn: string;
}): Promise<Pcn874File & { notes: Pcn874Note[] }> {
  const [entity] = await db
    .select({ osekMurshe: businessEntities.osekMurshe })
    .from(businessEntities)
    .where(eq(businessEntities.id, params.businessEntityId))
    .limit(1);
  if (!entity) throw new Pcn874Error("Business not found.");
  const { sales, notes } = await loadPcn874Sales(params);
  const file = buildPcn874({
    reporterVatNumber: entity.osekMurshe?.trim() ?? "",
    month: params.month,
    generatedOn: params.generatedOn,
    sales,
  });
  return { ...file, notes };
}
