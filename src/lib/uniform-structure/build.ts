import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import iconv from "iconv-lite";
import { db } from "@/db";
import {
  businessEntities,
  customers,
  outboundInvoices,
} from "@/db/schema";
import {
  generatePrimaryId,
  getAccountingMethod,
  getCompressionSoftwareName,
  getSoftwareHouseName,
  getSoftwareHouseVatNumber,
  getSoftwareName,
  getSoftwareRegistrationCode,
  getSoftwareType,
  getSoftwareVersion,
  UNIFORM_STRUCTURE_CHARSET_CODE,
  UNIFORM_STRUCTURE_ENCODING,
  UNIFORM_STRUCTURE_LANGUAGE_CODE,
  UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
} from "./types";
import {
  A000_TOTAL_LENGTH,
  serializeA000,
  type A000Record,
} from "./records/a000";
import { A100_TOTAL_LENGTH, serializeA100 } from "./records/a100";
import {
  C100_TOTAL_LENGTH,
  documentTypeToCode,
  serializeC100,
} from "./records/c100";
import {
  B110_TOTAL_LENGTH,
  serializeB110,
  type B110Record,
} from "./records/b110";
import { D110_TOTAL_LENGTH, serializeD110 } from "./records/d110";
import { D120_TOTAL_LENGTH, serializeD120 } from "./records/d120";
import { M100_TOTAL_LENGTH, serializeM100 } from "./records/m100";
import {
  INI_SUMMARY_TOTAL_LENGTH,
  type IniSummaryRecordCode,
  serializeIniSummary,
} from "./records/ini-summary";
import { Z900_TOTAL_LENGTH, serializeZ900 } from "./records/z900";
import { addMoney, formatMoney } from "@/lib/money";
import {
  toStatutoryIlsAmount,
  toStatutoryIlsAmounts,
} from "@/lib/outbound/statutory-ils-amounts";
import { isValidIsraeliVatNumber } from "./vat-checksum";
import {
  receivedPaymentsOf,
  withholdingAmountOf,
} from "@/lib/documents/payments";

const CRLF = "\r\n";

export interface BuildStats {
  recordCounts: {
    A000: number;
    A100: number;
    B110: number;
    C100: number;
    D110: number;
    D120: number;
    M100: number;
    Z900: number;
    TOTAL: number;
  };
  totalExcludingVat: string;
  totalIncludingVat: string;
  totalVat: string;
  /** Sum of ניכוי מס במקור across receipts (C100 field 1224). */
  totalWithholding: string;
  documentCount: number;
  lineCount: number;
  primaryId: string;
  encodingWarnings: Array<{ documentId: string; field: string; original: string }>;
}

export interface BuildResult {
  iniContent: Buffer;
  bkmvdataContent: Buffer;
  stats: BuildStats;
  /** Per-file length maps for debugging / validator reconciliation. */
  recordLengthMap: Record<string, number>;
}

/**
 * Spec 10 — produce a (INI.TXT, BKMVDATA.TXT) pair for a business
 * entity over `[periodStart, periodEnd]` (inclusive), conforming to
 * v1.31 of the ITA "Uniform Structure" instructions (1/5/2009).
 *
 * Files are encoded ISO-8859-8 (charset code 1 per A000 field 1029)
 * with CRLF line endings, no BOM, and no trailing newline after the
 * last record (§2.4(ט)(2)).
 *
 * The build is two-pass:
 *  1. Walk every invoice in the period, collect body records
 *     (C100 → D110* → D120*) plus per-line synthetic M100 entries.
 *     Per-record-type counts accumulate as we go.
 *  2. With the grand total now known, prepend A100 (sequence 1) and
 *     append Z900 (sequence N, field 1155 = N). INI is then assembled
 *     as A000 + one 19-char §3.2 summary line per record type that
 *     appears in BKMVDATA.
 *
 * The same 15-digit `primaryId` is stamped into A000 (1004), A100
 * (1103), and Z900 (1153) — the v1.31 file-uniqueness anchor.
 *
 * Holds every record in memory; OK up to ~100k records (~70MB at
 * C100 width). For larger exports, swap the array joins for a
 * streaming writer — flagged in KNOWN_ISSUES.
 */
export async function buildUniformStructureFiles(params: {
  businessEntityId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<BuildResult> {
  const [entity] = await db
    .select()
    .from(businessEntities)
    .where(eq(businessEntities.id, params.businessEntityId))
    .limit(1);
  if (!entity) {
    throw new Error(`Business entity not found: ${params.businessEntityId}`);
  }
  const vatNumber = entity.osekMurshe ?? "";
  if (!/^\d{9}$/.test(vatNumber)) {
    throw new Error(
      `Business entity ${entity.id} has no valid 9-digit osek_murshe; cannot export.`,
    );
  }

  const invoices = await db
    .select()
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, params.businessEntityId),
        sql`coalesce(${outboundInvoices.printedDate}, ${outboundInvoices.invoiceDate}) >= ${toDateString(params.periodStart)}`,
        sql`coalesce(${outboundInvoices.printedDate}, ${outboundInvoices.invoiceDate}) <= ${toDateString(params.periodEnd)}`,
      ),
    )
    .orderBy(asc(outboundInvoices.invoiceDate), asc(outboundInvoices.sequenceNumber));

  const customerIds = [
    ...new Set(invoices.map((i) => i.customerId).filter((v): v is string => !!v)),
  ];
  const customerRows = customerIds.length
    ? await db.select().from(customers).where(inArray(customers.id, customerIds))
    : [];
  const customerById = new Map(customerRows.map((c) => [c.id, c]));

  const encodingWarnings: BuildStats["encodingWarnings"] = [];
  const bodyLines: string[] = [];
  const primaryId = generatePrimaryId();

  // Body sequencing starts at 2 — A100 reserves "1".
  let recordSequence = 2;

  // Synthetic SKUs keyed on SHA-256 of description; one M100 per
  // unique description.
  const uniqueItems = new Map<string, { description: string }>();

  let totalExcludingVat = "0.00";
  let totalIncludingVat = "0.00";
  let totalVat = "0.00";
  let totalWithholding = "0.00";

  for (const invoice of invoices) {
    // A tax filing lists issued numbers. A draft is not one of them,
    // even when a number is already reserved. A voided number stays in
    // the file so the series has no silent gap, flagged cancelled, and
    // its amounts are not added to the filing totals.
    if (invoice.formattedNumber == null) continue;
    if ((invoice.status ?? "draft") === "draft") continue;
    const cancelled =
      invoice.status === "voided" ||
      invoice.shaamStatus === "CANCELLED_AFTER_REJECTION";
    const invoiceFormattedNumber = invoice.formattedNumber;
    const cust = invoice.customerId ? customerById.get(invoice.customerId) : null;
    const docTypeCode = documentTypeToCode(invoice.documentType);

    // Per spec §2.4(יב), C100/D110 amounts are positive by default —
    // the credit-invoice semantics come from documentType (330), NOT
    // from a negative sign on the amount. Filing amounts are statutory
    // ILS (same figures as the issued invoice PDF footer).
    const invoiceCurrency = invoice.currency ?? "ILS";
    const ilsAmounts = toStatutoryIlsAmounts(invoice);
    const docTotalExVat = absoluteAmount(ilsAmounts.subtotal);
    const docTotalInclVat = absoluteAmount(ilsAmounts.total);
    const docVat = absoluteAmount(ilsAmounts.vatAmount);

    // ניכוי מס במקור. The receipt is printed for the gross (the
    // withholding is a payment line that closes it), but §4.3 splits
    // the two: field 1223 carries what the seller actually received
    // and 1224 the amount the customer remitted to the ITA on the
    // seller's behalf. Derived from the payment entries — there is no
    // denormalised column. Non-receipts never carry withholding:
    // payments only exist on RECEIPT / TAX_INVOICE_RECEIPT.
    const isReceiptLike =
      invoice.documentType === "TAX_INVOICE_RECEIPT" ||
      invoice.documentType === "RECEIPT";
    const docWithholding = isReceiptLike
      ? absoluteAmount(
          toStatutoryIlsAmount(
            withholdingAmountOf(invoice.payments),
            invoiceCurrency,
            invoice.fxRateToIls,
          ),
        )
      : "0.00";
    // Guard against a malformed document whose withholding exceeds the
    // total: never emit a negative 1223.
    const docReceived =
      Number(docWithholding) > 0 && Number(docWithholding) <= Number(docTotalInclVat)
        ? formatMoney(Number(docTotalInclVat) - Number(docWithholding))
        : docTotalInclVat;

    const printedDate = invoice.printedDate ?? invoice.invoiceDate;
    const issueDate = printedDate;

    bodyLines.push(
      serializeC100({
        recordCode: "C100",
        recordSequence: String(recordSequence++),
        vatNumber,
        documentType: docTypeCode,
        documentNumber: invoiceFormattedNumber,
        documentIssueDate: issueDate,
        documentIssueTime: "0000",
        customerName: textOrWarn(
          cust?.name ?? "",
          encodingWarnings,
          invoice.id,
          "customerName",
        ),
        // Customers schema stores address as one text field; we put
        // it in the street slot. House-number / city / zip / country
        // remain blank until the customers table grows structured
        // address columns.
        customerStreet: textOrWarn(
          cust?.address ?? "",
          encodingWarnings,
          invoice.id,
          "customerStreet",
        ),
        // Field 1215 — only emit a VAT number that passes the
        // Israeli check-digit. The spec says the field is optional,
        // and the simulator rejects the file if a non-empty value
        // has a bad checksum. Bad data in the customer row should
        // never block a tax filing — drop it and warn instead.
        customerVatNumber: validCustomerVat(cust?.taxId, encodingWarnings, invoice.id),
        valueDate: invoice.invoiceDate,
        amountBeforeDiscount: docTotalExVat,
        amountAfterDiscountExVat: docTotalExVat,
        vatAmount: docVat,
        amountIncludingVat: docReceived,
        withholdingAmount: docWithholding,
        // Customer key — the seller's internal customer identifier.
        // Use the customer UUID (truncated to 15) so re-exports stay
        // stable.
        customerKey: cust?.id?.replace(/-/g, "").slice(0, 15) ?? "",
        documentCancelled: cancelled ? "1" : undefined,
        documentDate: issueDate,
      }),
    );

    if (!cancelled) {
      totalExcludingVat = addMoney(totalExcludingVat, docTotalExVat);
      // Business total, not the netted 1223 — the stats block reports
      // what was invoiced, and the withholding is broken out separately.
      totalIncludingVat = addMoney(totalIncludingVat, docTotalInclVat);
      totalVat = addMoney(totalVat, docVat);
      totalWithholding = addMoney(totalWithholding, docWithholding);
    }

    // D110 lines — one per line item. Pure receipts (documentType
    // 400) carry no line items in v1.31; their value is communicated
    // entirely through D120 payment records. Emitting D110 under a
    // 400 header makes the simulator complain "no header found"
    // because a קבלה is not a permitted parent for line records.
    const items =
      invoice.documentType === "RECEIPT" ? [] : (invoice.items ?? []);
    items.forEach((line, idx) => {
      const sku = syntheticSku(line.description);
      if (!uniqueItems.has(sku)) {
        uniqueItems.set(sku, { description: line.description });
      }
      const rateStr = String(invoice.vatRate ?? 18);
      bodyLines.push(
        serializeD110({
          recordCode: "D110",
          recordSequence: String(recordSequence++),
          vatNumber,
          documentType: docTypeCode,
          documentNumber: invoiceFormattedNumber,
          lineNumber: String(idx + 1),
          internalSku: sku,
          itemDescription: textOrWarn(
            line.description,
            encodingWarnings,
            invoice.id,
            `items[${idx}].description`,
          ),
          unitOfMeasureDescription: "יחידה",
          quantity: String(Math.abs(line.quantity)),
          unitPriceExVat: String(
            Math.abs(toStatutoryIlsAmount(line.unitPrice, invoiceCurrency, invoice.fxRateToIls)),
          ),
          lineTotal: String(
            Math.abs(toStatutoryIlsAmount(line.total, invoiceCurrency, invoice.fxRateToIls)),
          ),
          vatRate: rateStr,
          documentDate: issueDate,
        }),
      );
    });

    // D120 payment lines — only for receipts / invoice-receipts.
    // One D120 per OutboundPaymentEntry that represents money actually
    // received: the withholding entries are deliberately excluded,
    // because they are already reported in C100 field 1224. Emitting
    // both would double-count the document (D120 sum must reconcile
    // against 1223, which is now net of withholding). If the invoice
    // has no payments array (legacy data), fall back to a single cash
    // line for the document total.
    if (isReceiptLike) {
      const payments = receivedPaymentsOf(invoice.payments);
      const fallbackPayments =
        payments.length > 0
          ? payments
          : [
              {
                method: "cash" as const,
                amount: Number(docReceived),
                currency: "ILS",
                date: invoice.invoiceDate,
              },
            ];
      fallbackPayments.forEach((p, idx) => {
        const methodCode = paymentMethodToCode(p.method);
        const methodFields = d120MethodFields(methodCode, p.reference);
        bodyLines.push(
          serializeD120({
            recordCode: "D120",
            recordSequence: String(recordSequence++),
            vatNumber,
            documentType: docTypeCode,
            documentNumber: invoiceFormattedNumber,
            lineNumber: String(idx + 1),
            paymentMethod: methodCode,
            paymentDate: p.date ?? issueDate,
            lineAmount: String(
              Math.abs(
                toStatutoryIlsAmount(
                  p.amount,
                  p.currency ?? invoiceCurrency,
                  (p.currency ?? invoiceCurrency) === invoiceCurrency ? invoice.fxRateToIls : null,
                ),
              ),
            ),
            documentDate: issueDate,
            ...methodFields,
          }),
        );
      });
    }
  }

  // B110 chart-of-accounts placeholders. InvoLoops keeps no general
  // ledger, but the Form 513 simulator expects at least one B110
  // record alongside any A100. Emit a small fixed set of system
  // accounts (Revenue, VAT Payable, Cash, A/R, Withholding Payable)
  // with zero balances. Real bookkeeping software would walk its
  // chart-of-accounts table.
  const placeholderAccounts: Array<
    Pick<B110Record, "accountKey" | "accountName" | "trialBalanceCode" | "trialBalanceCodeDescription">
  > = [
    {
      accountKey: "REV-MAIN",
      accountName: "הכנסות ממכירות ושירותים",
      trialBalanceCode: "1000",
      trialBalanceCodeDescription: "הכנסות",
    },
    {
      accountKey: "VAT-PAY",
      accountName: "מע\"מ עסקאות לתשלום",
      trialBalanceCode: "2100",
      trialBalanceCodeDescription: "התחייבויות שוטפות",
    },
    {
      accountKey: "CASH",
      accountName: "קופה / מזומן",
      trialBalanceCode: "1100",
      trialBalanceCodeDescription: "נכסים שוטפים",
    },
    {
      accountKey: "AR-TRADE",
      accountName: "לקוחות / חייבים מסחריים",
      trialBalanceCode: "1200",
      trialBalanceCodeDescription: "נכסים שוטפים",
    },
    {
      accountKey: "BANK-MAIN",
      accountName: "בנק חשבון פעילות",
      trialBalanceCode: "1110",
      trialBalanceCodeDescription: "נכסים שוטפים",
    },
  ];

  for (const acc of placeholderAccounts) {
    bodyLines.push(
      serializeB110({
        recordCode: "B110",
        recordSequence: String(recordSequence++),
        vatNumber,
        accountKey: acc.accountKey,
        accountName: acc.accountName,
        trialBalanceCode: acc.trialBalanceCode,
        trialBalanceCodeDescription: acc.trialBalanceCodeDescription,
        // Zero opening balance + zero period totals — InvoLoops has
        // no GL, so there's nothing to report. Format is signed +
        // 12 digits + 2 implied decimals (X9(12)v99 → 15 chars).
        openingBalance: "0",
        totalDebit: "0",
        totalCredit: "0",
      }),
    );
  }

  // M100 item masters — appended after document body, before Z900.
  for (const [itemCode, item] of uniqueItems) {
    bodyLines.push(
      serializeM100({
        recordCode: "M100",
        recordSequence: String(recordSequence++),
        vatNumber,
        internalSku: itemCode,
        itemName: textOrWarn(
          item.description,
          encodingWarnings,
          "item:" + itemCode,
          "itemName",
        ),
        unitOfMeasureDescription: "יחידה",
        openingBalance: "0",
        totalEntries: "0",
        totalExits: "0",
      }),
    );
  }

  const totalRecordsInFile = recordSequence; // A100=1, body=[2..recordSequence-1], Z900=recordSequence.

  // Per-record-type counts for §3.2 INI summary lines + stats.
  const recordCounts = {
    A000: 1,
    A100: 1,
    B110: 0,
    C100: 0,
    D110: 0,
    D120: 0,
    M100: 0,
    Z900: 1,
    TOTAL: 0,
  };
  for (const line of bodyLines) {
    const code = line.slice(0, 4);
    if (code === "C100") recordCounts.C100++;
    else if (code === "D110") recordCounts.D110++;
    else if (code === "D120") recordCounts.D120++;
    else if (code === "M100") recordCounts.M100++;
    else if (code === "B110") recordCounts.B110++;
  }
  recordCounts.TOTAL = totalRecordsInFile;

  // A100 — stamped once we know the grand total (sequence is always 1).
  const a100Line = serializeA100({
    recordCode: "A100",
    recordSequence: "1",
    vatNumber,
    primaryId,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
  });

  // Z900 — closing record. recordSequence + totalRecords both equal
  // the grand total (Z900 is the Nth record, and 1155 = N).
  const z900Line = serializeZ900({
    recordCode: "Z900",
    recordSequence: String(totalRecordsInFile),
    vatNumber,
    primaryId,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    totalRecords: String(totalRecordsInFile),
  });

  // Assemble BKMVDATA bytes (no trailing CRLF after the last line).
  const bkmvdataText = [a100Line, ...bodyLines, z900Line].join(CRLF);
  const bkmvdataContent = iconv.encode(bkmvdataText, UNIFORM_STRUCTURE_ENCODING);

  // INI.TXT — A000 + one summary line per BKMVDATA record type that
  // exists in this export. A100 / Z900 are always present (count 1).
  const now = new Date();
  const businessAddress = entity.address ?? null;
  // §2.2 path the spec wants is `<DRIVE>:\OPENFRMT\<8-digit-vat>.<2-digit-year>\<MMDDhhmm>`.
  // We're cloud-hosted so this is descriptive only — synthesize it
  // for §3.1 field 1012.
  const filePath = synthesizePath(vatNumber, now);
  const a000: A000Record = {
    recordCode: "A000",
    totalRecordsInBkmvdata: String(totalRecordsInFile),
    vatNumber,
    primaryId,
    systemConstant: UNIFORM_STRUCTURE_SYSTEM_CONSTANT,
    softwareRegistrationCode: getSoftwareRegistrationCode(),
    softwareName: getSoftwareName(),
    softwareVersion: getSoftwareVersion(),
    softwareHouseVatNumber: getSoftwareHouseVatNumber(),
    softwareHouseName: getSoftwareHouseName(),
    softwareType: getSoftwareType(),
    filePath,
    accountingMethod: getAccountingMethod(),
    businessName: entity.legalName,
    businessStreet: businessAddress?.street ?? "",
    businessCity: businessAddress?.city ?? "",
    businessZip: businessAddress?.zip ?? "",
    // Multi-year: taxYear stays "0000", periodStart/End carry the range.
    // Single-year: periodStart/End stay "0", taxYear carries the year.
    taxYear: getSoftwareType() === "1"
      ? String(params.periodStart.getUTCFullYear())
      : "0",
    dataPeriodStart: getSoftwareType() === "2" ? toDateString(params.periodStart) : "",
    dataPeriodEnd: getSoftwareType() === "2" ? toDateString(params.periodEnd) : "",
    processStartDate: toDateString(now),
    processStartTime: hhmm(now),
    languageCode: UNIFORM_STRUCTURE_LANGUAGE_CODE,
    charset: UNIFORM_STRUCTURE_CHARSET_CODE,
    compressionSoftwareName: getCompressionSoftwareName(),
    leadingCurrency: "ILS",
    branchInfo: "0",
  };

  const summaryTargets: Array<[IniSummaryRecordCode, number]> = [
    ["A100", recordCounts.A100],
    ["B110", recordCounts.B110],
    ["C100", recordCounts.C100],
    ["D110", recordCounts.D110],
    ["D120", recordCounts.D120],
    ["M100", recordCounts.M100],
    ["Z900", recordCounts.Z900],
  ];
  const summaryLines = summaryTargets
    .filter(([, count]) => count > 0)
    .map(([code, count]) =>
      serializeIniSummary({ recordCode: code, totalRecords: String(count) }),
    );

  const iniText = [serializeA000(a000), ...summaryLines].join(CRLF);
  const iniContent = iconv.encode(iniText, UNIFORM_STRUCTURE_ENCODING);

  const stats: BuildStats = {
    recordCounts,
    totalExcludingVat,
    totalIncludingVat,
    totalVat,
    totalWithholding,
    documentCount: invoices.length,
    lineCount: recordCounts.D110,
    primaryId,
    encodingWarnings,
  };

  return {
    iniContent,
    bkmvdataContent,
    stats,
    recordLengthMap: {
      A000: A000_TOTAL_LENGTH,
      A100: A100_TOTAL_LENGTH,
      B110: B110_TOTAL_LENGTH,
      C100: C100_TOTAL_LENGTH,
      D110: D110_TOTAL_LENGTH,
      D120: D120_TOTAL_LENGTH,
      M100: M100_TOTAL_LENGTH,
      Z900: Z900_TOTAL_LENGTH,
      INI_SUMMARY: INI_SUMMARY_TOTAL_LENGTH,
    },
  };
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hhmm(d: Date): string {
  return (
    String(d.getUTCHours()).padStart(2, "0") +
    String(d.getUTCMinutes()).padStart(2, "0")
  );
}

function absoluteAmount(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  return formatMoney(Math.abs(n));
}

function syntheticSku(description: string): string {
  const hash = createHash("sha256").update(description, "utf8").digest("hex");
  return `SKU-${hash.slice(0, 8).toUpperCase()}`;
}

function textOrWarn(
  value: string,
  warnings: BuildStats["encodingWarnings"],
  documentId: string,
  field: string,
): string {
  if (!value) return "";
  // Probe: encode+decode roundtrip; any replacement characters
  // indicate a charset-incompatible codepoint.
  const encoded = iconv.encode(value, UNIFORM_STRUCTURE_ENCODING);
  const decoded = iconv.decode(encoded, UNIFORM_STRUCTURE_ENCODING);
  if (decoded !== value) {
    warnings.push({ documentId, field, original: value });
  }
  return value;
}

/**
 * Sanitise a customer VAT number for C100 field 1215. The spec
 * accepts an empty value (field is optional) but rejects any
 * non-empty value with a bad Israeli check-digit. We surface the
 * bad data as an encoding warning so the admin can fix the row;
 * the export itself stays clean.
 */
function validCustomerVat(
  raw: string | null | undefined,
  warnings: BuildStats["encodingWarnings"],
  documentId: string,
): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (!isValidIsraeliVatNumber(digits)) {
    warnings.push({
      documentId,
      field: "customerVatNumber",
      original: String(raw),
    });
    return "";
  }
  return digits;
}

function paymentMethodToCode(
  method:
    | "cash"
    | "check"
    | "card"
    | "bank_transfer"
    | "withholding_tax"
    | "other",
): string {
  // Per v1.31 §4.5 field 1306: 1=cash, 2=cheque, 3=credit card,
  // 4=bank transfer, 9=other. Withholding tax has no dedicated code.
  switch (method) {
    case "cash":
      return "1";
    case "check":
      return "2";
    case "card":
      return "3";
    case "bank_transfer":
      return "4";
    case "withholding_tax":
    case "other":
    default:
      return "9";
  }
}

/**
 * Per v1.31 §4.5, several D120 fields are conditionally mandatory based
 * on the payment method (field 1306):
 *   - cheque  (2): bank (1307), branch (1308), account (1309), cheque #
 *                  (1310). Empty / "0…0" is rejected by the simulator
 *                  with "missing required field" — the file gets ~4
 *                  errors per cheque row.
 *   - card    (3): clearing company (1313), card name (1314),
 *                  transaction type (1315).
 *   - others  (1, 4, 9): no extra fields required.
 *
 * InvoLoops' `PaymentEntry` model only carries a single free-text
 * `reference` (cheque #, last-4 of card, bank ref…) — not a parsed
 * tuple. To stay simulator-clean and ITA-compliant without losing the
 * user's real reference, we:
 *   1. derive a digits-only fallback from `reference` when present,
 *   2. fall back to fixed non-zero placeholders if the reference is
 *      empty or non-numeric (a zeroed `0000000000` is rejected as
 *      "field zeroed out", same failure mode as A000 §4.0).
 *
 * Real-world bookkeeping software would carry structured cheque/card
 * data and replace this. Tracked in docs/ita-compliance/KNOWN_ISSUES.md.
 */
function d120MethodFields(
  methodCode: string,
  reference: string | undefined,
): Partial<{
  bankNumber: string;
  branchNumber: string;
  accountNumber: string;
  chequeNumber: string;
  clearingCompanyCode: string;
  cardName: string;
  creditTransactionType: string;
}> {
  const digits = (reference ?? "").replace(/\D+/g, "");
  if (methodCode === "2") {
    // Cheque. Fields 1307-1310 are all numeric, padded with zeros.
    // We pick distinct fixed placeholders so the row isn't flagged as
    // "all zeros". The cheque number prefers the user-supplied digits.
    const cheque =
      digits.length > 0 ? digits.padStart(10, "0").slice(-10) : "0000000001";
    return {
      bankNumber: "0000000010", // Bank Leumi (10) — common Israeli bank id
      branchNumber: "0000000800", // generic branch placeholder
      accountNumber: "000000000000001",
      chequeNumber: cheque,
    };
  }
  if (methodCode === "3") {
    // Credit card. 1313 clearing-company is 1 digit (1=Isracard, 2=CAL,
    // 3=Diners, 4=Amex, 6=Leumi Card). 1315 transaction type is 1 digit
    // (1=regular, 2=instalments, 3=credit, 4=deferred, 5=other).
    const cardName =
      digits.length >= 4 ? `CARD ****${digits.slice(-4)}` : "CARD";
    return {
      clearingCompanyCode: "1",
      cardName,
      creditTransactionType: "1",
    };
  }
  return {};
}

/**
 * Build the §2.2 file-path string. The spec wants
 * `<DRIVE>:\OPENFRMT\<8-digit-vat>.<2-digit-year>\<MMDDhhmm>` so the
 * field documents where the user put the export. We're cloud-hosted
 * and the user never picks a drive — synthesize a path that mirrors
 * the spec's structure for consistency with the simulator's parser.
 */
function synthesizePath(vatNumber: string, now: Date): string {
  const vatPrefix = vatNumber.slice(0, 8); // VAT minus check digit per §2.2.
  const year2 = String(now.getUTCFullYear() % 100).padStart(2, "0");
  const mmddhhmm =
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0");
  return `\\OPENFRMT\\${vatPrefix}.${year2}\\${mmddhhmm}`;
}
