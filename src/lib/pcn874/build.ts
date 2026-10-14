/**
 * PCN874 — the monthly detailed VAT report, sales side.
 *
 * Layout: "Deployment for PCN874 File Generation", Appendix A (header,
 * transaction and closing entries) and Appendix C (values per entry type),
 * `docs/ita-compliance/references/IncomeTax_IncomeTaxSoftwareHousesInfo_874-eng.pdf`.
 * The last field of a transaction entry — "space for future data, reference
 * number to be allocated by Sha'am" — carries the 9 right-most digits of
 * the allocation number (Israel Invoice model v2.0 §2.2.1).
 *
 * Sales only, by decision (2026-10): the documents this app issues are
 * signed and numbered here, so their figures can be trusted. Purchases
 * (inputs) are left at zero for the accountant to add.
 *
 * Pure: no database, no clock. `load.ts` gathers the documents.
 */

export class Pcn874Error extends Error {}

/** One issued sales document, amounts already in ILS. */
export interface Pcn874Sale {
  documentId: string;
  /** The printed number, e.g. `2026-TI-000042`. */
  formattedNumber: string;
  /** Number-series prefix (`TI`, `TIR`, `CI`) — the reference group. */
  seriesPrefix: string;
  /** The date printed on the document, `YYYY-MM-DD`. */
  invoiceDate: string;
  /** Customer's 9-digit licensed-dealer number, when valid; else null. */
  customerVatNumber: string | null;
  /** ILS, before VAT, as stored (negative on a credit note is fine). */
  preVatIls: number;
  /** ILS VAT, as stored. */
  vatIls: number;
  isCredit: boolean;
  allocationNumber: string | null;
}

export interface Pcn874Totals {
  taxableSales: number;
  taxableVat: number;
  zeroOrExemptSales: number;
  salesRecords: number;
  vatToPay: number;
}

export interface Pcn874File {
  /** CRLF-terminated lines, ASCII only. */
  text: string;
  fileName: "PCN874.TXT";
  totals: Pcn874Totals;
}

const LINE_END = "\r\n";

/** N(n): digits, right-aligned, zero-padded. */
function num(value: number | string, width: number, field: string): string {
  const s = String(value);
  if (!/^\d+$/.test(s)) throw new Pcn874Error(`${field}: not a whole number (${s})`);
  if (s.length > width) throw new Pcn874Error(`${field}: ${s} does not fit in ${width} digits`);
  return s.padStart(width, "0");
}

/** A sign field and its amount: the amount always positive. */
function signed(value: number, width: number, field: string): string {
  // "When the amount field is zero, the value of the '+/-' field will be '+'."
  return (value < 0 ? "-" : "+") + num(Math.abs(value), width, field);
}

/** Rounded to the nearest shekel. */
function shekels(amount: number): number {
  return Math.round(Math.abs(amount));
}

/** The 9 right-most digits of a value, zero-padded; zeros when absent. */
export function rightMost9Digits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.slice(-9).padStart(9, "0");
}

/**
 * A(4) reference group — "series etc.". Our numbering restarts per
 * document type, so the type's prefix keeps a tax invoice and a credit
 * note with the same sequence number apart.
 */
function referenceGroup(prefix: string): string {
  const p = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (p.length > 4) throw new Pcn874Error(`reference group "${prefix}" is longer than 4`);
  return p.padStart(4, "0");
}

function ymd(date: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Pcn874Error(`${field}: bad date ${date}`);
  return date.replace(/-/g, "");
}

/** One transaction entry (60 characters). */
export function saleEntry(sale: Pcn874Sale): string {
  const identified = sale.customerVatNumber != null;
  const line =
    // S — regular sale to an identified customer; L — unidentified
    // (private) customer, reported per invoice with zeros for the number.
    (identified ? "S" : "L") +
    num(sale.customerVatNumber ?? "0", 9, "customerVatNumber") +
    ymd(sale.invoiceDate, "invoiceDate") +
    referenceGroup(sale.seriesPrefix) +
    rightMost9Digits(sale.formattedNumber) +
    num(shekels(sale.vatIls), 9, "vat") +
    // A credit (cancellation) to the customer is always minus.
    (sale.isCredit ? "-" : "+") +
    num(shekels(sale.preVatIls), 10, "preVat") +
    rightMost9Digits(sale.allocationNumber);
  if (line.length !== 60) {
    throw new Pcn874Error(`transaction entry for ${sale.formattedNumber} is ${line.length} long`);
  }
  return line;
}

export function pcn874Totals(sales: Pcn874Sale[]): Pcn874Totals {
  let taxableSales = 0;
  let taxableVat = 0;
  let zeroOrExemptSales = 0;
  for (const s of sales) {
    const sign = s.isCredit ? -1 : 1;
    const vat = shekels(s.vatIls);
    const preVat = shekels(s.preVatIls);
    // Figures as reported in the entries, so the header adds up to them.
    // Taxable is decided on the document's VAT, not on its rounded value.
    if (Math.abs(s.vatIls) >= 0.005) {
      taxableSales += sign * preVat;
      taxableVat += sign * vat;
    } else {
      zeroOrExemptSales += sign * preVat;
    }
  }
  return {
    taxableSales,
    taxableVat,
    zeroOrExemptSales,
    salesRecords: sales.length,
    // No inputs in this file: the VAT to pay is the VAT on sales.
    vatToPay: taxableVat,
  };
}

/** Header entry (131 characters). */
export function headerEntry(params: {
  reporterVatNumber: string;
  month: string;
  generatedOn: string;
  totals: Pcn874Totals;
}): string {
  const { totals } = params;
  if (!/^\d{4}-\d{2}$/.test(params.month)) throw new Pcn874Error(`bad month ${params.month}`);
  const line =
    "O" +
    num(params.reporterVatNumber, 9, "reporterVatNumber") +
    params.month.replace("-", "") +
    "1" + // report type
    ymd(params.generatedOn, "generatedOn") +
    signed(totals.taxableSales, 11, "taxableSales") +
    signed(totals.taxableVat, 9, "taxableVat") +
    signed(0, 11, "otherRateSales") + // "currently zeros — for future use"
    signed(0, 9, "otherRateVat") +
    num(totals.salesRecords, 9, "salesRecords") +
    signed(totals.zeroOrExemptSales, 11, "zeroOrExemptSales") +
    signed(0, 9, "otherInputsVat") +
    signed(0, 9, "equipmentInputsVat") +
    num(0, 9, "inputRecords") +
    signed(totals.vatToPay, 11, "vatToPay");
  if (line.length !== 131) throw new Pcn874Error(`header entry is ${line.length} long`);
  return line;
}

/** Closing entry (10 characters). */
export function closingEntry(reporterVatNumber: string): string {
  return "X" + num(reporterVatNumber, 9, "reporterVatNumber");
}

export function buildPcn874(params: {
  reporterVatNumber: string;
  /** `YYYY-MM` */
  month: string;
  /** `YYYY-MM-DD` */
  generatedOn: string;
  sales: Pcn874Sale[];
}): Pcn874File {
  if (!/^\d{9}$/.test(params.reporterVatNumber)) {
    throw new Pcn874Error("The business has no 9-digit licensed-dealer number to report under.");
  }
  const sales = [...params.sales].sort(
    (a, b) =>
      a.invoiceDate.localeCompare(b.invoiceDate) ||
      a.formattedNumber.localeCompare(b.formattedNumber),
  );
  const totals = pcn874Totals(sales);
  const lines = [
    headerEntry({
      reporterVatNumber: params.reporterVatNumber,
      month: params.month,
      generatedOn: params.generatedOn,
      totals,
    }),
    ...sales.map(saleEntry),
    closingEntry(params.reporterVatNumber),
  ];
  return { text: lines.join(LINE_END) + LINE_END, fileName: "PCN874.TXT", totals };
}
