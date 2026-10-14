/**
 * Sandbox-only seeder for the ITA Form 513 certification packet.
 *
 * Generates ~2000 outbound invoices across all six v1.31 document
 * types (TI / TIR / RC / CI / PRO / DN), spread over Jan-Apr 2026,
 * tied to ~50 synthetic customers with valid Israeli VAT numbers.
 * Inserts directly into the sandbox DB — NO audit log, NO signing,
 * NO sequence-number lock contention. Drafts are skipped so the
 * Uniform Structure export picks them all up.
 *
 * Run from inside the sandbox app container (where DATABASE_URL
 * points at the sandbox Postgres):
 *   docker compose -f docker-compose.sandbox.yml exec app \
 *     npx tsx scripts/seed-certification-dataset.ts
 *
 * Or set BUSINESS_ENTITY_ID + DATABASE_URL and run on host. The
 * script auto-detects the business entity if there's exactly one
 * with a valid 9-digit `osek_murshe`.
 *
 * NOT idempotent: every run appends another batch (sequence numbers
 * advance from the current max). Run once, generate the export,
 * delete the seeded rows if you want to re-seed.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNotNull, max as sqlMax } from "drizzle-orm";
import postgres from "postgres";
import { businessEntities } from "../src/db/schema/business-entities";
import { customers } from "../src/db/schema/customers";
import {
  outboundInvoices,
  type OutboundLineItem,
  type OutboundPaymentEntry,
} from "../src/db/schema/outbound-invoices";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const client = postgres(connectionString);
const db = drizzle(client);

const TARGET_TOTAL = Number(process.env.SEED_TARGET ?? 2050);
const TAX_YEAR = 2026;

type DocType =
  | "TAX_INVOICE"
  | "TAX_INVOICE_RECEIPT"
  | "RECEIPT"
  | "CREDIT_INVOICE"
  | "PROFORMA"
  | "DELIVERY_NOTE";

const PREFIX: Record<DocType, string> = {
  TAX_INVOICE: "TI",
  TAX_INVOICE_RECEIPT: "TIR",
  RECEIPT: "RC",
  CREDIT_INVOICE: "CI",
  PROFORMA: "PF",
  DELIVERY_NOTE: "DN",
};

// Distribution sums to ~2050; tweak via SEED_TARGET to scale.
const DISTRIBUTION: Record<DocType, number> = {
  TAX_INVOICE: 600,
  TAX_INVOICE_RECEIPT: 600,
  RECEIPT: 250,
  CREDIT_INVOICE: 200,
  PROFORMA: 250,
  DELIVERY_NOTE: 150,
};

// ----- helpers ------------------------------------------------------

/** Generate a random valid 9-digit Israeli VAT number (passes the Luhn-like checksum). */
function randomValidIsraeliVat(): string {
  const eight = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const product = eight[i] * ((i % 2) + 1);
    sum += product > 9 ? product - 9 : product;
  }
  // Sum so far is for positions 1-8 (weights 1,2,1,2,...). Position 9
  // has weight 1; pick the digit that makes (sum + d) % 10 === 0.
  const checkDigit = (10 - (sum % 10)) % 10;
  return [...eight, checkDigit].join("");
}

const HEBREW_NAMES = [
  "אורה כהן בע\"מ",
  "מוצרי טכנולוגיה גליל",
  "שירותי ייעוץ צפון",
  "סופר חברה בע\"מ",
  "תקשורת ישראל",
  "פיתוח תוכנה דרום",
  "מערכות מידע ערבה",
  "סטודיו עיצוב חיפה",
  "ייצור ושיווק נגב",
  "שירותי הסעות מטרו",
  "הוצאה לאור ירושלים",
  "מסעדת השף",
  "חנות הספרים האדומה",
  "סופר פארם פלוס",
  "אופטיקה ראייה זהב",
  "מרכז רפואי הצפון",
  "שירותי משפט אבני",
  "ראיית חשבון לוי",
  "חברה לפיתוח עסקי",
  "טכנולוגיות ענן",
];

const HEBREW_CITIES = [
  "תל אביב", "חיפה", "ירושלים", "באר שבע", "אילת",
  "נצרת", "רמת גן", "חולון", "פתח תקווה", "אשדוד",
];

const HEBREW_STREETS = [
  "הרצל", "ז'בוטינסקי", "דיזנגוף", "אלנבי", "בן יהודה",
  "השלום", "התעשייה", "הזית", "הברוש", "המייסדים",
];

const ITEM_DESCRIPTIONS = [
  "ייעוץ עסקי שעתי",
  "פיתוח תוכנה — חודשי",
  "תחזוקה — שירות מנוי",
  "אחסון אתרים — שנתי",
  "שירותי הדרכה",
  "מוצר A — יחידה",
  "מוצר B — יחידה",
  "חבילת שירות פלטינום",
  "חבילת שירות זהב",
  "חבילת שירות כסף",
  "החזר הוצאות נסיעה",
  "אגרת רישוי",
  "התקנה ראשונית",
  "ייעוץ אבטחת מידע",
  "בדיקת איכות ובקרה",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function randomDateInPeriod(): Date {
  // Spread across Jan 1 – Apr 27, 2026 (matches the sandbox export period).
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2026, 3, 27);
  return new Date(start + Math.random() * (end - start));
}

function buildLineItems(): OutboundLineItem[] {
  const count = randInt(1, 4);
  const items: OutboundLineItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const quantity = randInt(1, 10);
    const unitPrice = randInt(50, 5000);
    const total = quantity * unitPrice;
    items.push({
      description: pick(ITEM_DESCRIPTIONS),
      quantity,
      unitPrice,
      total,
    });
  }
  return items;
}

function buildPayments(total: number, dateStr: string): OutboundPaymentEntry[] {
  const methods: OutboundPaymentEntry["method"][] = [
    "cash",
    "check",
    "card",
    "bank_transfer",
  ];
  // 60% single-method, 40% split across two methods (more variety
  // for D120 records — simulator likes diversity).
  if (Math.random() < 0.6) {
    return [
      {
        method: pick(methods),
        amount: total,
        currency: "ILS",
        date: dateStr,
        reference: `REF-${randInt(10000, 99999)}`,
      },
    ];
  }
  const half1 = Math.round(total / 2);
  return [
    {
      method: pick(methods),
      amount: half1,
      currency: "ILS",
      date: dateStr,
      reference: `REF-${randInt(10000, 99999)}`,
    },
    {
      method: pick(methods),
      amount: total - half1,
      currency: "ILS",
      date: dateStr,
      reference: `REF-${randInt(10000, 99999)}`,
    },
  ];
}

// ----- main ---------------------------------------------------------

async function main() {
  console.log("[seed] Connecting to DB…");

  // ----- 1. Pick the business entity ------------------------------
  let businessEntityId = process.env.BUSINESS_ENTITY_ID ?? null;
  let userId: string | null = null;
  let osekMurshe: string | null = null;

  if (!businessEntityId) {
    const rows = await db
      .select({
        id: businessEntities.id,
        ownerUserId: businessEntities.ownerUserId,
        osekMurshe: businessEntities.osekMurshe,
      })
      .from(businessEntities)
      .where(isNotNull(businessEntities.osekMurshe));
    const valid = rows.filter(
      (r) => r.osekMurshe && /^\d{9}$/.test(r.osekMurshe),
    );
    if (valid.length === 0) {
      console.error(
        "[seed] No business entity with a 9-digit osek_murshe. Set BUSINESS_ENTITY_ID explicitly.",
      );
      process.exit(2);
    }
    if (valid.length > 1) {
      console.error(
        `[seed] Found ${valid.length} business entities. Set BUSINESS_ENTITY_ID to disambiguate.`,
      );
      for (const r of valid) console.error(`  - ${r.id} (osek=${r.osekMurshe})`);
      process.exit(3);
    }
    businessEntityId = valid[0].id;
    userId = valid[0].ownerUserId;
    osekMurshe = valid[0].osekMurshe;
  } else {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(eq(businessEntities.id, businessEntityId))
      .limit(1);
    if (!row) {
      console.error(`[seed] Business entity ${businessEntityId} not found.`);
      process.exit(4);
    }
    userId = row.ownerUserId;
    osekMurshe = row.osekMurshe;
  }

  console.log(
    `[seed] Using businessEntityId=${businessEntityId} (osek_murshe=${osekMurshe})`,
  );

  // ----- 2. Make sure we have a pool of customers -----------------
  const existingCustomers = await db
    .select({ id: customers.id, name: customers.name, taxId: customers.taxId })
    .from(customers)
    .where(eq(customers.userId, userId!));
  console.log(`[seed] Found ${existingCustomers.length} existing customers.`);

  const TARGET_CUSTOMERS = 50;
  const customerPool: Array<{ id: string; name: string; taxId: string | null }> = [
    ...existingCustomers,
  ];

  if (customerPool.length < TARGET_CUSTOMERS) {
    const toCreate = TARGET_CUSTOMERS - customerPool.length;
    console.log(`[seed] Creating ${toCreate} additional customers…`);
    const seenNames = new Set(existingCustomers.map((c) => c.name));
    const newRows: typeof customers.$inferInsert[] = [];
    for (let i = 0; i < toCreate; i += 1) {
      const baseName = pick(HEBREW_NAMES);
      let suffix = 0;
      while (seenNames.has(suffix === 0 ? baseName : `${baseName} ${suffix}`)) {
        suffix += 1;
      }
      const name = suffix === 0 ? baseName : `${baseName} ${suffix}`;
      seenNames.add(name);
      const street = `${pick(HEBREW_STREETS)} ${randInt(1, 200)}`;
      newRows.push({
        userId: userId!,
        name,
        email: `customer${randInt(1000, 9999)}@example.co.il`,
        phone: `0${randInt(2, 9)}-${randInt(1000000, 9999999)}`,
        address: `${street}, ${pick(HEBREW_CITIES)}`,
        taxId: randomValidIsraeliVat(),
      });
    }
    if (newRows.length > 0) {
      const inserted = await db
        .insert(customers)
        .values(newRows)
        .returning({ id: customers.id, name: customers.name, taxId: customers.taxId });
      customerPool.push(...inserted);
      console.log(`[seed] Inserted ${inserted.length} new customers.`);
    }
  }

  // ----- 3. Find the next sequence number per (type, year) --------
  const nextSeq: Record<DocType, number> = {
    TAX_INVOICE: 1,
    TAX_INVOICE_RECEIPT: 1,
    RECEIPT: 1,
    CREDIT_INVOICE: 1,
    PROFORMA: 1,
    DELIVERY_NOTE: 1,
  };

  for (const type of Object.keys(DISTRIBUTION) as DocType[]) {
    const [row] = await db
      .select({ maxSeq: sqlMax(outboundInvoices.sequenceNumber) })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.businessEntityId, businessEntityId!),
          eq(outboundInvoices.documentType, type),
          eq(outboundInvoices.taxYear, TAX_YEAR),
        ),
      );
    const current = Number(row?.maxSeq ?? 0);
    nextSeq[type] = current + 1;
    console.log(`[seed]   next ${type} sequence → ${nextSeq[type]}`);
  }

  // ----- 4. Generate rows ----------------------------------------
  const allRows: typeof outboundInvoices.$inferInsert[] = [];
  const counts: Record<DocType, number> = {
    TAX_INVOICE: 0,
    TAX_INVOICE_RECEIPT: 0,
    RECEIPT: 0,
    CREDIT_INVOICE: 0,
    PROFORMA: 0,
    DELIVERY_NOTE: 0,
  };

  // Scale by SEED_TARGET / 2050 if user wants more/fewer.
  const scale = TARGET_TOTAL / 2050;

  for (const type of Object.keys(DISTRIBUTION) as DocType[]) {
    const want = Math.round(DISTRIBUTION[type] * scale);
    const isPaid = type === "TAX_INVOICE_RECEIPT" || type === "RECEIPT";
    const hasItems = type !== "RECEIPT"; // pure receipts have only payments

    for (let i = 0; i < want; i += 1) {
      const cust = pick(customerPool);
      const issueDate = randomDateInPeriod();
      const dateStr = fmtDate(issueDate);

      const items: OutboundLineItem[] = hasItems ? buildLineItems() : [];
      let subtotal = items.reduce((s, it) => s + it.total, 0);
      if (!hasItems) {
        // Pure receipts still need a total — invent one.
        subtotal = randInt(100, 50000);
      }
      const vatRate = 18;
      const vatAmount = Math.round(subtotal * (vatRate / 100));
      const total = subtotal + vatAmount;

      const seq = nextSeq[type]++;
      const formattedNumber = `${TAX_YEAR}-${PREFIX[type]}-${String(seq).padStart(6, "0")}`;
      const payments: OutboundPaymentEntry[] = isPaid
        ? buildPayments(total, dateStr)
        : [];

      allRows.push({
        userId: userId!,
        businessEntityId: businessEntityId!,
        customerId: cust.id,
        documentType: type,
        taxYear: TAX_YEAR,
        sequenceNumber: seq,
        formattedNumber,
        invoiceNumber: formattedNumber,
        invoiceDate: dateStr,
        items,
        payments,
        subtotal: subtotal.toFixed(2),
        vatRate: vatRate.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        total: total.toFixed(2),
        currency: "ILS",
        language: "he",
        status: "issued",
        pdfKind: "final",
      });
      counts[type] += 1;
    }
  }

  console.log(`[seed] Prepared ${allRows.length} invoice rows:`);
  for (const t of Object.keys(counts) as DocType[]) {
    console.log(`         ${t.padEnd(22)} ${counts[t]}`);
  }

  // ----- 5. Bulk insert in chunks --------------------------------
  const CHUNK = 250;
  console.log(`[seed] Inserting in chunks of ${CHUNK}…`);
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    await db.insert(outboundInvoices).values(chunk);
    process.stdout.write(`  inserted ${Math.min(i + CHUNK, allRows.length)} / ${allRows.length}\r`);
  }
  console.log("");
  console.log("[seed] Done.");
  await client.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error("[seed] FAILED:", err);
  await client.end({ timeout: 5 });
  process.exit(99);
});
