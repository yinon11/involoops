/**
 * Verification harness for the PCN874 file, sales side (`src/lib/pcn874/`).
 *
 * Run: `DATABASE_URL=... npx tsx scripts/verify-pcn874.ts`
 *
 * The layout checks are pure. The loader checks need a real database —
 * which documents of a month are sales, and which are not — and write only
 * their own fixtures (ids prefixed `dddd0000-`), removed afterwards. Do not
 * point it at production.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { businessEntities, customers, outboundInvoices, users } from "@/db/schema";
import {
  buildPcn874,
  closingEntry,
  headerEntry,
  Pcn874Error,
  pcn874Totals,
  saleEntry,
  type Pcn874Sale,
} from "@/lib/pcn874/build";
import { generatePcn874 } from "@/lib/pcn874/load";

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sale = (over: Partial<Pcn874Sale> = {}): Pcn874Sale => ({
  documentId: "x",
  formattedNumber: "2026-TI-000042",
  seriesPrefix: "TI",
  invoiceDate: "2026-09-15",
  customerVatNumber: "515000008",
  preVatIls: 10000.4,
  vatIls: 1800.07,
  isCredit: false,
  allocationNumber: "2026091512345678901",
  ...over,
});

function layout() {
  const s = saleEntry(sale());
  record("1. sale entry: 60 chars, S, customer, date, group, ref, VAT, sign, amount, allocation",
    s === "S" + "515000008" + "20260915" + "00TI" + "026000042" + "000001800" + "+" + "0000010000" + "345678901",
    s);

  const credit = saleEntry(sale({
    formattedNumber: "2026-CI-000007", seriesPrefix: "CI",
    preVatIls: -2500.5, vatIls: -450.09, isCredit: true, allocationNumber: null,
  }));
  record("2. credit note: minus sign, positive rounded amounts, zeros for no allocation",
    credit.length === 60 && credit[0] === "S" && credit[40] === "-" &&
      credit.slice(31, 40) === "000000450" && credit.slice(41, 51) === "0000002501" &&
      credit.slice(51) === "000000000",
    credit);

  const priv = saleEntry(sale({ customerVatNumber: null }));
  record("3. no customer number → L with zeros", priv.startsWith("L000000000"), priv.slice(0, 10));

  const sales = [
    sale(),
    sale({ formattedNumber: "2026-TI-000043", preVatIls: 5000, vatIls: 0 }), // reverse charge / zero rate
    sale({ formattedNumber: "2026-CI-000007", seriesPrefix: "CI", preVatIls: -2000, vatIls: -360, isCredit: true }),
  ];
  const totals = pcn874Totals(sales);
  record("4. totals: taxable net of credits, zero-rate apart, VAT to pay = VAT on sales",
    totals.taxableSales === 8000 && totals.taxableVat === 1440 &&
      totals.zeroOrExemptSales === 5000 && totals.salesRecords === 3 && totals.vatToPay === 1440,
    JSON.stringify(totals));

  const h = headerEntry({ reporterVatNumber: "514000001", month: "2026-09", generatedOn: "2026-10-01", totals });
  record("5. header: 131 chars, O, reporter, month, type 1, date, signed totals, zero inputs",
    h.length === 131 && h.startsWith("O514000001202609" + "1" + "20261001") &&
      h.slice(25, 37) === "+00000008000" && h.slice(37, 47) === "+000001440" &&
      h.slice(69, 78) === "000000003" && h.slice(78, 90) === "+00000005000" &&
      h.slice(110, 119) === "000000000" && h.slice(119) === "+00000001440",
    h);

  const neg = headerEntry({
    reporterVatNumber: "514000001", month: "2026-09", generatedOn: "2026-10-01",
    totals: pcn874Totals([sale({ preVatIls: -100, vatIls: -18, isCredit: true })]),
  });
  record("6. a month of credits only → minus signs in the header", neg.slice(25, 26) === "-" && neg.slice(119, 120) === "-", neg);

  record("7. closing entry: X + reporter", closingEntry("514000001") === "X514000001");

  const file = buildPcn874({ reporterVatNumber: "514000001", month: "2026-09", generatedOn: "2026-10-01", sales });
  const lines = file.text.split("\r\n");
  record("8. file: header, entries by date, closing, CRLF, ASCII",
    lines.length === 6 && lines[5] === "" && lines[0][0] === "O" && lines[4][0] === "X" &&
      /^[\x20-\x7e\r\n]*$/.test(file.text) && file.fileName === "PCN874.TXT",
    `${lines.length} lines`);

  let threw = false;
  try {
    buildPcn874({ reporterVatNumber: "", month: "2026-09", generatedOn: "2026-10-01", sales });
  } catch (e) { threw = e instanceof Pcn874Error; }
  record("9. no licensed-dealer number for the business → refused", threw);
}

// --- loader ---------------------------------------------------------------

const P = "dddd0000-0000-0000-0000-0000000000";
const USER = `${P}ff`;
const ENTITY = `${P}fe`;
const CUST = `${P}c1`;
const CUST_PRIVATE = `${P}c2`;
const D = (n: string) => `${P}${n}`;
const DOCS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"].map(D);

async function cleanup() {
  await db.delete(outboundInvoices).where(inArray(outboundInvoices.id, DOCS));
  await db.delete(customers).where(inArray(customers.id, [CUST, CUST_PRIVATE]));
  await db.delete(businessEntities).where(eq(businessEntities.id, ENTITY));
  await db.delete(users).where(eq(users.id, USER));
}

async function loader() {
  await db.insert(users).values({ id: USER, email: "verify-pcn874@test.local" });
  await db.insert(businessEntities).values({
    id: ENTITY, ownerUserId: USER, legalName: "Seller Ltd", osekMurshe: "514000001",
  });
  await db.insert(customers).values([
    { id: CUST, userId: USER, name: "Buyer Ltd", taxId: "515000008" },
    { id: CUST_PRIVATE, userId: USER, name: "Private Person", taxId: null },
  ]);
  const base = {
    userId: USER, businessEntityId: ENTITY, customerId: CUST, taxYear: 2026,
    invoiceDate: "2026-09-10", printedDate: "2026-09-10",
    subtotal: "1000.00", vatRate: "18", vatAmount: "180.00", total: "1180.00",
    items: [{ description: "x", quantity: 1, unitPrice: 1000, total: 1000 }],
  };
  const num = (prefix: string, n: number) => ({
    formattedNumber: `2026-${prefix}-${String(n).padStart(6, "0")}`, invoiceNumber: String(n), sequenceNumber: n,
  });
  await db.insert(outboundInvoices).values([
    // In: an issued tax invoice with its allocation number.
    { id: D("01"), ...base, ...num("TI", 1), status: "issued", allocationNumber: "123456789012", shaamStatus: "APPROVED" },
    // In: a tax invoice later fully credited — still a sale that month.
    { id: D("02"), ...base, ...num("TI", 2), status: "voided" },
    // In: the credit note.
    { id: D("03"), ...base, ...num("CI", 1), documentType: "CREDIT_INVOICE", status: "issued",
      subtotal: "-1000.00", vatAmount: "-180.00", total: "-1180.00", referencesDocumentId: D("02") },
    // In: USD at its frozen rate, to a private customer, allocation pending.
    { id: D("04"), ...base, ...num("TI", 3), status: "sent", customerId: CUST_PRIVATE, currency: "USD",
      subtotal: "100.00", vatAmount: "18.00", total: "118.00", fxRateToIls: "3.700000", fxRateSource: "boi",
      shaamStatus: "OUTAGE_ISSUED" },
    // Out: cancelled after an ITA refusal — never issued.
    { id: D("05"), ...base, ...num("TI", 4), status: "voided", shaamStatus: "CANCELLED_AFTER_REJECTION" },
    // Out: a draft.
    { id: D("06"), ...base, status: "draft" },
    // Out: another month.
    { id: D("07"), ...base, ...num("TI", 5), status: "issued", invoiceDate: "2026-10-01", printedDate: "2026-10-01" },
    // Out: a receipt is not a sale for VAT.
    { id: D("08"), ...base, ...num("RC", 1), documentType: "RECEIPT", status: "issued" },
    // In: printed in the month though created earlier.
    { id: D("09"), ...base, ...num("TIR", 1), documentType: "TAX_INVOICE_RECEIPT", status: "paid",
      invoiceDate: "2026-08-30", printedDate: "2026-09-02" },
  ] as never);

  const file = await generatePcn874({ businessEntityId: ENTITY, month: "2026-09", generatedOn: "2026-10-01" });
  const entries = file.text.split("\r\n").filter((l) => l && l[0] !== "O" && l[0] !== "X");
  const refs = entries.map((e) => `${e.slice(18, 22)}:${e.slice(22, 31)}`).sort();
  record("10. the month's sales: issued, credited, credit note, USD, invoice-receipt — not cancelled, draft, other month, receipt",
    entries.length === 5 &&
      JSON.stringify(refs) === JSON.stringify(["00CI:026000001", "00TI:026000001", "00TI:026000002", "00TI:026000003", "0TIR:026000001"]),
    refs.join(" "));

  const usd = entries.find((e) => e.slice(18, 31) === "00TI026000003") ?? "";
  record("11. USD invoice in ILS at its frozen rate, as an unidentified sale",
    usd.startsWith("L000000000") && usd.slice(31, 40) === "000000067" && usd.slice(41, 51) === "0000000370",
    usd);
  const withAlloc = entries.find((e) => e.slice(18, 31) === "00TI026000001") ?? "";
  record("12. allocation number's 9 right-most digits in the last field", withAlloc.slice(51) === "456789012", withAlloc);
  record("13. header nets the credit note: taxable 1,000+1,000−1,000+370+1,000 = 2,370",
    file.totals.taxableSales === 2370 && file.totals.taxableVat === 427 && file.totals.salesRecords === 5,
    JSON.stringify(file.totals));
  record("14. notes: the private customer, and the allocation still pending",
    file.notes.some((n) => n.formattedNumber === "2026-TI-000003" && n.kind === "no_customer_number") &&
      file.notes.some((n) => n.formattedNumber === "2026-TI-000003" && n.kind === "allocation_pending") &&
      file.notes.length === 2,
    JSON.stringify(file.notes));
}

async function main() {
  layout();
  if (!process.env.DATABASE_URL) {
    console.error("[verify-pcn874] DATABASE_URL is not set — skipping the loader checks.");
    process.exit(1);
  }
  await cleanup();
  try {
    await loader();
  } catch (err) {
    record("loader", false, err instanceof Error ? err.message : String(err));
  } finally {
    await cleanup();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[verify-pcn874] ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

void main();
