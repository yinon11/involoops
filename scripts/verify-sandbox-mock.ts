/**
 * Verification harness for the sandbox "Tax Authority answer" override,
 * set in the admin panel (`src/lib/shaam/sandbox-mock-outcome.ts`).
 *
 * Run: `DATABASE_URL=... npx tsx scripts/verify-sandbox-mock.ts`
 *
 * Proves the forced answers land exactly like real ones (status, error
 * code, hearing deadline, outage) without a request to the ITA, and that
 * they cannot reach production: on a stack that is not the sandbox the
 * setting can be neither written nor read. On the sandbox stack it applies
 * to every business, flagged sandbox or not.
 *
 * Writes only its own fixtures (ids prefixed `eeee0000-`) and removes them
 * afterwards. Do not point it at production.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  businessEntities,
  customers,
  outboundInvoices,
  shaamSubmissions,
  users,
} from "@/db/schema";
import { documentAuditLog } from "@/db/schema/document-audit-log";
import { submitDocumentToShaam } from "@/lib/shaam/submit";
import { notifyShaamDecision } from "@/lib/shaam/notify-decision";
import {
  getSandboxMockOutcome,
  isSandboxStack,
  parseSandboxMockOutcome,
  writeSandboxMockSetting,
} from "@/lib/shaam/sandbox-mock-outcome";
import { appSettings } from "@/db/schema";

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const P = "eeee0000-0000-0000-0000-0000000000";
const USER = `${P}ff`;
const USER_LIVE = `${P}fc`;
const SANDBOX = `${P}fe`;
const LIVE = `${P}fd`;
const CUST = `${P}c1`;
const CUST_LIVE = `${P}c2`;
const D = (n: string) => `${P}${n}`;
const DOCS = ["01", "02", "03", "04", "05", "06"].map(D);

function parsing() {
  const k = (o: ReturnType<typeof parseSandboxMockOutcome>) =>
    o ? (o.kind === "reject" ? `reject:${o.code}` : o.kind) : "null";
  const got = ["", "approve", "reject", "REJECT:30", "hold", "outage", "nonsense"].map((v) => k(parseSandboxMockOutcome(v)));
  record("1. parses approve | reject[:code] | hold | outage; empty or unknown → normal",
    JSON.stringify(got) === JSON.stringify(["null", "approve", "reject:462", "reject:30", "hold", "outage", "null"]),
    got.join(","));
  record("2. only the sandbox stack (SIGNING_ENVIRONMENT=sandbox, SHAAM_ENV not PROD) qualifies",
    isSandboxStack({ SIGNING_ENVIRONMENT: "sandbox", SHAAM_ENV: "UAT" }) &&
      !isSandboxStack({ SIGNING_ENVIRONMENT: "sandbox", SHAAM_ENV: "PROD" }) &&
      !isSandboxStack({ SHAAM_ENV: "UAT" }) &&
      !isSandboxStack({ SIGNING_ENVIRONMENT: "production", SHAAM_ENV: "UAT" }));
}

/** As the admin panel does it. */
async function set(value: string) {
  const r = await writeSandboxMockSetting({ value, userId: USER });
  if (!r.ok) throw new Error(`setting "${value}" refused: ${r.error}`);
}

async function cleanup() {
  await db.delete(appSettings).where(eq(appSettings.key, "sandbox.shaam_mock_outcome"));
  await db.delete(shaamSubmissions).where(inArray(shaamSubmissions.businessEntityId, [SANDBOX, LIVE]));
  await db.delete(documentAuditLog).where(inArray(documentAuditLog.businessEntityId, [SANDBOX, LIVE]));
  await db.delete(outboundInvoices).where(inArray(outboundInvoices.id, DOCS));
  await db.delete(customers).where(inArray(customers.id, [CUST, CUST_LIVE]));
  await db.delete(businessEntities).where(inArray(businessEntities.id, [SANDBOX, LIVE]));
  await db.delete(users).where(inArray(users.id, [USER, USER_LIVE]));
}

async function seed() {
  await db.insert(users).values([
    { id: USER, email: "verify-sandbox-mock@test.local" },
    { id: USER_LIVE, email: "verify-sandbox-mock-live@test.local" },
  ]);
  await db.insert(businessEntities).values([
    { id: SANDBOX, ownerUserId: USER, legalName: "Sandbox Ltd", osekMurshe: "514000001", shaamSandbox: true },
    { id: LIVE, ownerUserId: USER_LIVE, legalName: "Live Ltd", osekMurshe: "516000007", shaamSandbox: false },
  ]);
  await db.insert(customers).values([
    { id: CUST, userId: USER, name: "Buyer Ltd", taxId: "515000008" },
    { id: CUST_LIVE, userId: USER_LIVE, name: "Buyer Ltd", taxId: "515000008" },
  ]);
  // Over the threshold, with VAT, to a licensed dealer: a number is owed.
  const base = {
    userId: USER, taxYear: 2026, invoiceDate: "2026-10-01", printedDate: "2026-10-01",
    subtotal: "50000.00", vatRate: "18", vatAmount: "9000.00", total: "59000.00",
    items: [{ description: "Consulting", quantity: 1, unitPrice: 50000, total: 50000 }],
    status: "draft" as const,
  };
  const num = (n: number) => ({ formattedNumber: `2026-TI-00010${n}`, invoiceNumber: String(n), sequenceNumber: 100 + n });
  await db.insert(outboundInvoices).values([
    { id: D("01"), ...base, ...num(1), businessEntityId: SANDBOX, customerId: CUST },
    { id: D("02"), ...base, ...num(2), businessEntityId: SANDBOX, customerId: CUST },
    { id: D("03"), ...base, ...num(3), businessEntityId: SANDBOX, customerId: CUST },
    { id: D("04"), ...base, ...num(4), businessEntityId: SANDBOX, customerId: CUST },
    { id: D("05"), ...base, ...num(5), businessEntityId: SANDBOX, customerId: CUST },
    { id: D("06"), ...base, ...num(6), userId: USER_LIVE, businessEntityId: LIVE, customerId: CUST_LIVE },
  ]);
}

async function row(id: string) {
  const [r] = await db.select().from(outboundInvoices).where(eq(outboundInvoices.id, id));
  return r;
}

async function forced() {
  // Any outbound call would mean the mock leaked into a real request.
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetched += 1;
    return realFetch(...args);
  }) as typeof fetch;
  try {
    await set("reject");
    const rej = await submitDocumentToShaam({ documentId: D("01"), actorUserId: USER });
    const r1 = await row(D("01"));
    record("3. reject → REJECTED, code 462, no allocation, nothing sent",
      rej.shaamStatus === "REJECTED" && r1.shaamStatus === "REJECTED" &&
        r1.shaamLastErrorCode === "462" && r1.allocationNumber === null && fetched === 0,
      `status=${r1.shaamStatus} code=${r1.shaamLastErrorCode} fetched=${fetched}`);

    await set("reject:30");
    await submitDocumentToShaam({ documentId: D("02"), actorUserId: USER });
    const r2 = await row(D("02"));
    record("4. reject:30 → refused with that code", r2.shaamStatus === "REJECTED" && r2.shaamLastErrorCode === "30",
      `status=${r2.shaamStatus} code=${r2.shaamLastErrorCode}`);

    await set("hold");
    await submitDocumentToShaam({ documentId: D("03"), actorUserId: USER });
    const r3 = await row(D("03"));
    const days = r3.shaamHearingDeadline
      ? Math.round((r3.shaamHearingDeadline.getTime() - Date.now()) / 86_400_000)
      : null;
    record("5. hold → HELD, code 460, hearing deadline in 14 days",
      r3.shaamStatus === "HELD" && r3.shaamLastErrorCode === "460" && days === 14,
      `status=${r3.shaamStatus} code=${r3.shaamLastErrorCode} days=${days}`);

    await set("outage");
    await submitDocumentToShaam({ documentId: D("04"), actorUserId: USER });
    const r4 = await row(D("04"));
    record("6. outage → OUTAGE_ISSUED (timeout), no allocation",
      r4.shaamStatus === "OUTAGE_ISSUED" && r4.shaamLastErrorCode === "timeout" && r4.allocationNumber === null,
      `status=${r4.shaamStatus} code=${r4.shaamLastErrorCode}`);

    await set("approve");
    const ok = await submitDocumentToShaam({ documentId: D("05"), actorUserId: USER });
    record("7. approve → local TEST- allocation", ok.shaamStatus === "APPROVED" && !!ok.allocationNumber?.startsWith("TEST-"),
      `status=${ok.shaamStatus} alloc=${ok.allocationNumber}`);

    const decision = await notifyShaamDecision({ documentId: D("01"), choice: "cancel", actorUserId: USER });
    record("8. the seller's choice on a forced refusal is not reported to the ITA",
      !decision.notified && decision.reason === "sandbox_mock" && fetched === 0,
      `reason=${decision.reason} fetched=${fetched}`);

    // A business on the sandbox stack that is not flagged sandbox: still
    // test data, so the forced answer applies to it too (requiring the flag
    // made the override silently miss such businesses).
    await set("reject");
    await submitDocumentToShaam({ documentId: D("06"), actorUserId: USER_LIVE });
    const r6 = await row(D("06"));
    record("9. applies to an unflagged business on the sandbox stack too",
      r6.shaamStatus === "REJECTED" && r6.shaamLastErrorCode === "462" && fetched === 0,
      `status=${r6.shaamStatus} code=${r6.shaamLastErrorCode} fetched=${fetched}`);

    // Off the sandbox stack the stored value is invisible and unwritable.
    process.env.SIGNING_ENVIRONMENT = "production";
    const offRead = await getSandboxMockOutcome();
    const offWrite = await writeSandboxMockSetting({ value: "hold", userId: USER });
    process.env.SIGNING_ENVIRONMENT = "sandbox";
    process.env.SHAAM_ENV = "PROD";
    const prodRead = await getSandboxMockOutcome();
    process.env.SHAAM_ENV = "UAT";
    record("10. off the sandbox stack (or with SHAAM_ENV=PROD) the setting is neither read nor written",
      offRead === null && !offWrite.ok && prodRead === null,
      `read=${JSON.stringify(offRead)} write=${offWrite.ok} prod=${JSON.stringify(prodRead)}`);

    const bad = await writeSandboxMockSetting({ value: "explode", userId: USER });
    await set("");
    const cleared = await getSandboxMockOutcome();
    record("11. an unknown value is refused; empty means normal",
      !bad.ok && cleared === null, `bad=${bad.ok} cleared=${JSON.stringify(cleared)}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function main() {
  parsing();
  // The request is built (and stored) even when the answer is forced.
  process.env.SHAAM_ACCOUNTING_SOFTWARE_NUMBER ??= "514000001";
  // Run as the sandbox stack.
  process.env.SIGNING_ENVIRONMENT = "sandbox";
  process.env.SHAAM_ENV = "UAT";
  if (!process.env.DATABASE_URL) {
    console.error("[verify-sandbox-mock] DATABASE_URL is not set.");
    process.exit(1);
  }
  await cleanup();
  try {
    await seed();
    await forced();
  } catch (err) {
    record("run", false, err instanceof Error ? err.message : String(err));
  } finally {
    await cleanup();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[verify-sandbox-mock] ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

void main();
