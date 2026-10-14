/**
 * Verification harness for how documents may leave the books.
 *
 * Run: `DATABASE_URL=... npx tsx scripts/verify-cancellation-rules.ts`
 *
 * - An issued tax invoice, tax invoice-receipt or credit invoice cannot be
 *   voided: it is cancelled by a credit invoice. A receipt still can.
 * - A draft that already holds a number cannot be deleted (or voided): it
 *   would leave a gap in the numbering. A numberless draft still can be
 *   discarded.
 *
 * The rules live in the operations, so the UI, the REST API and the MCP
 * tools all get them. Through the API a void is refused with 422
 * `cannot_void_document_type`, a delete with 409.
 *
 * Writes only its own fixtures (ids prefixed `dddd0000-`) and removes them
 * afterwards. Do not point it at production.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { businessEntities, customers, outboundInvoices, users } from "@/db/schema";
import { documentAuditLog } from "@/db/schema/document-audit-log";
import {
  deleteOutboundInvoiceOp,
  updateOutboundInvoiceStatusOp,
} from "@/lib/outbound/operations";
import { mapOutboundDomainError } from "@/lib/api/outbound-error-mapping";

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const P = "dddd0000-0000-0000-0000-0000000000";
const USER = `${P}ff`;
const ENTITY = `${P}fe`;
const CUST = `${P}c1`;
const D = (n: string) => `${P}${n}`;
const TI = D("01");
const TIR = D("02");
const RC = D("03");
const NUMBERED_DRAFT = D("04");
const PLAIN_DRAFT = D("05");
const TI_PAID = D("06");
const DOCS = [TI, TIR, RC, NUMBERED_DRAFT, PLAIN_DRAFT, TI_PAID];

async function cleanup() {
  await db.delete(documentAuditLog).where(eq(documentAuditLog.businessEntityId, ENTITY));
  await db.delete(outboundInvoices).where(inArray(outboundInvoices.id, DOCS));
  await db.delete(customers).where(eq(customers.id, CUST));
  await db.delete(businessEntities).where(eq(businessEntities.id, ENTITY));
  await db.delete(users).where(eq(users.id, USER));
}

async function seed() {
  // Platform admin: passes every permission check, so the harness tests
  // the document rules rather than RBAC.
  await db.insert(users).values({ id: USER, email: "verify-cancel@test.local", isAdmin: true });
  await db.insert(businessEntities).values({
    id: ENTITY, ownerUserId: USER, legalName: "Seller Ltd", osekMurshe: "514000001",
  });
  await db.insert(customers).values({ id: CUST, userId: USER, name: "Buyer Ltd", taxId: "515000008" });
  const base = {
    userId: USER, businessEntityId: ENTITY, customerId: CUST,
    invoiceDate: "2026-09-01", taxYear: 2026,
    subtotal: "1000.00", vatRate: "18", vatAmount: "180.00", total: "1180.00",
    items: [{ description: "Consulting", quantity: 1, unitPrice: 1000, total: 1000 }],
  };
  const num = (prefix: string, n: number) => ({
    formattedNumber: `2026-${prefix}-${String(n).padStart(6, "0")}`,
    invoiceNumber: String(n), sequenceNumber: n,
  });
  await db.insert(outboundInvoices).values([
    { id: TI, ...base, ...num("TI", 1), status: "issued" as const },
    { id: TIR, ...base, ...num("TIR", 1), documentType: "TAX_INVOICE_RECEIPT" as const, status: "issued" as const,
      payments: [{ method: "bank_transfer", amount: 1180, currency: "ILS", date: "2026-09-01", reference: "T1" }] },
    { id: RC, ...base, ...num("RC", 1), documentType: "RECEIPT" as const, status: "issued" as const,
      vatRate: "0", vatAmount: "0.00", total: "1000.00",
      payments: [{ method: "bank_transfer", amount: 1000, currency: "ILS", date: "2026-09-01", reference: "R1" }] },
    // Refused by the Tax Authority at issue: still a draft, number spent.
    { id: NUMBERED_DRAFT, ...base, ...num("TI", 2), status: "draft" as const, shaamStatus: "REJECTED" as const },
    { id: PLAIN_DRAFT, ...base, status: "draft" as const },
    { id: TI_PAID, ...base, ...num("TI", 3), status: "issued" as const },
  ] as never);
}

async function row(id: string) {
  const [r] = await db.select().from(outboundInvoices).where(eq(outboundInvoices.id, id));
  return r;
}

async function refusal(fn: () => Promise<unknown>): Promise<{ refused: boolean; message: string; httpStatus: number | null }> {
  try {
    await fn();
    return { refused: false, message: "", httpStatus: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { refused: true, message, httpStatus: mapOutboundDomainError(err).status };
  }
}

async function run() {
  const caller = { userId: USER, businessEntityId: ENTITY };

  const tiVoid = await refusal(() => updateOutboundInvoiceStatusOp(caller, TI, "voided"));
  const tirVoid = await refusal(() => updateOutboundInvoiceStatusOp(caller, TIR, "voided"));
  const [tiAfter, tirAfter] = [await row(TI), await row(TIR)];
  record("1. an issued tax invoice and tax invoice-receipt cannot be voided (422, unchanged)",
    tiVoid.refused && tirVoid.refused && tiVoid.httpStatus === 422 && tirVoid.httpStatus === 422 &&
      tiAfter.status === "issued" && tirAfter.status === "issued" &&
      /credit invoice/i.test(tiVoid.message),
    `ti=${tiVoid.httpStatus} tir=${tirVoid.httpStatus}`);

  await updateOutboundInvoiceStatusOp(caller, TI_PAID, "paid");
  const paidVoid = await refusal(() => updateOutboundInvoiceStatusOp(caller, TI_PAID, "voided"));
  const paidAfter = await row(TI_PAID);
  record("2. marking a tax invoice paid still works; voiding it once paid is refused",
    paidAfter.status === "paid" && paidVoid.refused, `status=${paidAfter.status}`);

  const rcVoid = await refusal(() => updateOutboundInvoiceStatusOp(caller, RC, "voided"));
  const rcAfter = await row(RC);
  record("3. a receipt can still be voided", !rcVoid.refused && rcAfter.status === "voided",
    rcVoid.message || `status=${rcAfter.status}`);

  const numberedDelete = await refusal(() => deleteOutboundInvoiceOp(caller, NUMBERED_DRAFT));
  const numberedVoid = await refusal(() => updateOutboundInvoiceStatusOp(caller, NUMBERED_DRAFT, "voided"));
  const numberedAfter = await row(NUMBERED_DRAFT);
  record("4. a draft holding a number can be neither deleted nor voided (409, still there)",
    numberedDelete.refused && numberedDelete.httpStatus === 409 &&
      numberedVoid.refused && numberedVoid.httpStatus === 409 &&
      numberedAfter.deletedAt === null && numberedAfter.status === "draft",
    `delete=${numberedDelete.httpStatus} void=${numberedVoid.httpStatus}`);

  const plainDelete = await refusal(() => deleteOutboundInvoiceOp(caller, PLAIN_DRAFT));
  const plainAfter = await row(PLAIN_DRAFT);
  record("5. a numberless draft can still be discarded", !plainDelete.refused && plainAfter.deletedAt !== null,
    plainDelete.message);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[verify-cancellation-rules] DATABASE_URL is not set.");
    process.exit(1);
  }
  await cleanup();
  try {
    await seed();
    await run();
  } catch (err) {
    record("run", false, err instanceof Error ? err.message : String(err));
  } finally {
    await cleanup();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[verify-cancellation-rules] ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

void main();
