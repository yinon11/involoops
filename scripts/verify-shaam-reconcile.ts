/**
 * Verification harness for the SHAAM reconciliation scans:
 * the clearance ladder (`src/lib/shaam/reconcile-scan.ts`) and the
 * decision-notification retry (`findUnnotifiedDecisions`).
 *
 * Run: `DATABASE_URL=... npx tsx scripts/verify-shaam-reconcile.ts`
 *
 * Unlike `verify-shaam-submission.ts` this one needs a real database: the
 * thing under test is a SQL predicate, and a predicate that composes
 * cleanly in TypeScript can still match the wrong rows. It seeds documents
 * at known points on each ladder, runs the real scan, and asserts exactly
 * which ones come back.
 *
 * Writes only to its own fixture rows (ids prefixed `eeee0000-`) and
 * removes them afterwards, so it is safe against a scratch database. Do
 * not point it at production.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  outboundInvoices,
  shaamSubmissions,
  users,
  businessEntities,
} from "@/db/schema";
import { buildReconcileScanWhere } from "@/lib/shaam/reconcile-scan";
import {
  findUnnotifiedDecisions,
  MAX_DECISION_ATTEMPTS,
} from "@/lib/shaam/notify-decision";

const USER_ID = "eeee0000-0000-0000-0000-0000000000ff";
const ENTITY_ID = "eeee0000-0000-0000-0000-0000000000fe";
const PREFIX = "eeee0000-0000-0000-0000-0000000000";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** id suffix → [status, retryCount, holdPollCount, age, shouldBeDue] */
const FIXTURES: Array<
  [string, "PENDING" | "OUTAGE_ISSUED" | "HELD" | "APPROVED", number, number, string, boolean]
> = [
  // Transient ladder. Rung 0 is 30s, but the 5-minute eligibility floor wins.
  ["01", "OUTAGE_ISSUED", 0, 0, "1 minute", false],
  ["02", "OUTAGE_ISSUED", 0, 0, "10 minutes", true],
  // Rung 8 = 7200s (2h).
  ["03", "OUTAGE_ISSUED", 8, 0, "30 minutes", false],
  ["04", "OUTAGE_ISSUED", 8, 0, "3 hours", true],
  // At MAX_RETRIES the retire sweep owns it, not the scan.
  ["05", "OUTAGE_ISSUED", 10, 0, "3 days", false],
  ["06", "PENDING", 0, 0, "10 minutes", true],
  // Hold ladder. Rung 0 = 1h.
  ["07", "HELD", 0, 0, "30 minutes", false],
  ["08", "HELD", 0, 0, "2 hours", true],
  // Past the end of the ladder every rung is 86400s (daily).
  ["09", "HELD", 0, 9, "12 hours", false],
  ["10", "HELD", 0, 9, "30 hours", true],
  // Older than HELD_MAX_AGE_MS — we stop asking.
  ["11", "HELD", 0, 9, "60 days", false],
  // Proves which counter paces a hold. Poll count 0 puts it on rung 0
  // (1h) and two hours have passed, so it is due. Had the hold ladder
  // read `shaamRetryCount` instead, 9 would be past the end of the ladder
  // (24h) and this row would wrongly sit idle for another day.
  ["12", "HELD", 9, 0, "2 hours", true],
  // Terminal states are out of scope entirely.
  ["13", "APPROVED", 0, 0, "3 days", false],
];

async function seed() {
  await db
    .insert(users)
    .values({ id: USER_ID, email: "verify-reconcile@test.local" })
    .onConflictDoNothing();
  await db
    .insert(businessEntities)
    .values({
      id: ENTITY_ID,
      ownerUserId: USER_ID,
      legalName: "Reconcile Verify Ltd",
      osekMurshe: "999999999",
    })
    .onConflictDoNothing();

  for (const [suffix, status, retries, polls, age] of FIXTURES) {
    await db
      .insert(outboundInvoices)
      .values({
        id: `${PREFIX}${suffix}`,
        userId: USER_ID,
        businessEntityId: ENTITY_ID,
        invoiceDate: "2026-09-01",
        taxYear: 2026,
        subtotal: "100",
        total: "118",
        shaamStatus: status,
        shaamRetryCount: retries,
        shaamHoldPollCount: polls,
        shaamSubmittedAt: sql`now() - interval '${sql.raw(age)}'`,
      })
      .onConflictDoNothing();
  }
}

const FIXTURE_IDS = FIXTURES.map(([suffix]) => `${PREFIX}${suffix}`);

async function cleanup() {
  await db
    .delete(shaamSubmissions)
    .where(eq(shaamSubmissions.businessEntityId, ENTITY_ID));
  await db
    .delete(outboundInvoices)
    .where(inArray(outboundInvoices.id, FIXTURE_IDS));
  await db.delete(businessEntities).where(eq(businessEntities.id, ENTITY_ID));
  await db.delete(users).where(eq(users.id, USER_ID));
}

/**
 * Decision-retry fixtures. `[doc suffix, label, attempts, shouldBeDue]`,
 * where each attempt is `[actionCode, choice-or-error-code, status, age]`.
 *
 * These prove the four things that decide whether we spend another call
 * on the ITA: the backoff, the attempt cap, the "already landed" guard,
 * and that only real choices on decision rows are replayed.
 */
type Attempt = [number, string, "APPROVED" | "REJECTED", string];
const DECISIONS: Array<[string, string, Attempt[], string[]]> = [
  [
    "d1",
    "one failed cancel, an hour past",
    [[0, "cancel", "REJECTED", "2 hours"]],
    ["cancel"],
  ],
  [
    "d2",
    "one failed cancel, minutes old — backoff holds it",
    [[0, "cancel", "REJECTED", "5 minutes"]],
    [],
  ],
  [
    "d3",
    "failed then accepted — nothing owed",
    [
      [0, "cancel", "REJECTED", "3 hours"],
      [0, "cancel", "APPROVED", "2 hours"],
    ],
    [],
  ],
  [
    "d4",
    `${MAX_DECISION_ATTEMPTS} failures — cap reached`,
    Array.from(
      { length: MAX_DECISION_ATTEMPTS },
      (_, i) => [0, "cancel", "REJECTED", `${i + 2} hours`] as Attempt,
    ),
    [],
  ],
  [
    "d5",
    "legacy row holding an ITA error code, not a choice",
    [[0, "463", "REJECTED", "2 hours"]],
    [],
  ],
  [
    "d6",
    "hearing refused then cancelled — both owed",
    [
      [0, "request_hearing", "REJECTED", "3 hours"],
      [0, "cancel", "REJECTED", "2 hours"],
    ],
    ["cancel", "request_hearing"],
  ],
  [
    "d7",
    "a clearance row is not a decision",
    [[1, "cancel", "REJECTED", "2 hours"]],
    [],
  ],
];

const DECISION_DOC_IDS = DECISIONS.map(([suffix]) => `${PREFIX}${suffix}`);

async function seedDecisions() {
  for (const [suffix, , attempts] of DECISIONS) {
    const documentId = `${PREFIX}${suffix}`;
    let n = 0;
    for (const [actionCode, code, status, age] of attempts) {
      n += 1;
      await db
        .insert(shaamSubmissions)
        .values({
          documentId,
          businessEntityId: ENTITY_ID,
          environment: "UAT",
          actionCode,
          idempotencyKey: `verify-${suffix}-${n}`,
          requestPayload: {},
          requestPayloadHash: `verify-${suffix}-${n}`,
          responseStatus: status,
          responseErrorCode: code,
          submittedAt: sql`now() - interval '${sql.raw(age)}'`,
        })
        .onConflictDoNothing();
    }
  }
}

async function runDecisionPhase() {
  const found = await findUnnotifiedDecisions(Date.now(), 1000);
  const byDoc = new Map<string, string[]>();
  for (const row of found) {
    if (!DECISION_DOC_IDS.includes(row.documentId)) continue;
    byDoc.set(row.documentId, [
      ...(byDoc.get(row.documentId) ?? []),
      row.choice,
    ]);
  }

  for (const [suffix, label, , expected] of DECISIONS) {
    const actual = (byDoc.get(`${PREFIX}${suffix}`) ?? []).sort();
    const want = [...expected].sort();
    const ok =
      actual.length === want.length && actual.every((c, i) => c === want[i]);
    record(
      `${suffix}. ${label} → ${want.length ? want.join("+") : "nothing"}`,
      ok,
      ok ? "" : `got ${actual.length ? actual.join("+") : "nothing"}`,
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[verify-shaam-reconcile] DATABASE_URL is not set — this harness needs a scratch database.",
    );
    process.exit(1);
  }

  await cleanup();
  await seed();
  await seedDecisions();

  try {
    const rows = await db
      .select({
        id: outboundInvoices.id,
        shaamStatus: outboundInvoices.shaamStatus,
      })
      .from(outboundInvoices)
      .where(
        and(
          buildReconcileScanWhere(Date.now()),
          inArray(outboundInvoices.id, FIXTURE_IDS),
        ),
      );
    const due = new Set(rows.map((r) => r.id));

    for (const [suffix, status, retries, polls, age, shouldBeDue] of FIXTURES) {
      const id = `${PREFIX}${suffix}`;
      const actual = due.has(id);
      record(
        `${suffix}. ${status} retries=${retries} polls=${polls} age=${age} → ${shouldBeDue ? "due" : "not due"}`,
        actual === shouldBeDue,
        actual === shouldBeDue ? "" : `got ${actual ? "due" : "not due"}`,
      );
    }

    await runDecisionPhase();
  } finally {
    await cleanup();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[verify-shaam-reconcile] ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

void main();
