/**
 * Business-number uniqueness.
 *
 *   1. Dashes and a short digit string normalize to 9 digits.
 *   2. A bad Israeli check digit is refused.
 *   3. A second entity cannot save a number the first one holds, and the
 *      error does not name the other account.
 *   4. A free valid number saves.
 *   5. Support can correct a number only when the entity has no non-draft
 *      documents, and only onto a valid unused number.
 *
 * Writes only when DATABASE_URL points at localhost. Rows are deleted
 * before the process exits.
 *
 * Run: `npx tsx scripts/verify-osek-uniqueness.ts`
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { db, postgresClient } from "@/db";
import { auditLog, businessEntities, outboundInvoices, users } from "@/db/schema";
import { isValidIsraeliVatNumber } from "@/lib/uniform-structure/vat-checksum";
import {
  DUPLICATE_OSEK_MESSAGE,
  INVALID_OSEK_CHECKSUM_MESSAGE,
  OSEK_ISSUED_DOCUMENTS_MESSAGE,
  OSEK_RATE_LIMIT_MESSAGE,
  OsekMursheError,
  normalizeOsekMurshe,
} from "@/lib/business-entity/osek-number";
import {
  assertOsekMursheAvailable,
  correctOsekMurshe,
  isOsekUniqueViolation,
} from "@/lib/business-entity/osek-uniqueness";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function withCheckDigit(first8: string): string {
  for (let digit = 0; digit <= 9; digit++) {
    const candidate = `${first8}${digit}`;
    if (isValidIsraeliVatNumber(candidate)) return candidate;
  }
  throw new Error(`no check digit for ${first8}`);
}

async function main(): Promise<void> {
  const dashed = normalizeOsekMurshe("000-000.018");
  check(dashed === "000000018", `expected padded 000000018, got ${dashed}`);
  const short = normalizeOsekMurshe("18");
  check(short === "000000018", `expected left-pad, got ${short}`);

  let checksumRefused = false;
  try {
    normalizeOsekMurshe("123456789");
  } catch (err) {
    checksumRefused =
      err instanceof OsekMursheError &&
      err.code === "invalid_checksum" &&
      err.message === INVALID_OSEK_CHECKSUM_MESSAGE;
  }
  check(checksumRefused, "bad check digit was not refused");
  console.log("pure: normalize ok, bad check digit refused");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const host = new URL(databaseUrl).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `Refusing to write test rows: DATABASE_URL host is ${host}`,
    );
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const userIds: string[] = [];
  const entityIds: string[] = [];
  try {
    const existing = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname = 'business_entities_osek_murshe_unique'
    `;
    if (existing.length === 0) {
      const file = readFileSync(
        resolve("drizzle/0034_business_entities_osek_unique.sql"),
        "utf8",
      );
      await sql.unsafe(file);
      console.log("applied 0034_business_entities_osek_unique");
    }

    async function unusedNumber(seed: number): Promise<string> {
      for (let i = 0; i < 40; i++) {
        const first8 = String(seed + i).padStart(8, "0").slice(0, 8);
        const candidate = withCheckDigit(first8);
        const rows = await sql<{ id: string }[]>`
          SELECT id FROM business_entities WHERE osek_murshe = ${candidate} LIMIT 1
        `;
        if (rows.length === 0) return candidate;
      }
      throw new Error(`no free number near ${seed}`);
    }

    const taken = await unusedNumber(51000000);
    const fresh = await unusedNumber(52000000);
    const corrected = await unusedNumber(53000000);
    const blockedTarget = await unusedNumber(54000000);

    const emailA = `osek-a-${randomUUID()}@example.com`;
    const emailB = `osek-b-${randomUUID()}@example.com`;
    const [userA] = await db
      .insert(users)
      .values({ email: emailA })
      .returning({ id: users.id });
    const [userB] = await db
      .insert(users)
      .values({ email: emailB })
      .returning({ id: users.id });
    userIds.push(userA.id, userB.id);

    const [entityA] = await db
      .insert(businessEntities)
      .values({
        ownerUserId: userA.id,
        legalName: "Osek uniqueness A",
        osekMurshe: taken,
      })
      .returning({ id: businessEntities.id, osekMurshe: businessEntities.osekMurshe });
    entityIds.push(entityA.id);
    check(entityA.osekMurshe === taken, "normal save did not store the number");

    let duplicateRefused = false;
    try {
      await assertOsekMursheAvailable({
        osekMurshe: taken,
        userId: userB.id,
      });
    } catch (err) {
      duplicateRefused =
        err instanceof OsekMursheError &&
        err.code === "duplicate" &&
        err.message === DUPLICATE_OSEK_MESSAGE &&
        !err.message.includes(emailA) &&
        !err.message.includes(userA.id);
    }
    check(duplicateRefused, "duplicate signup was not refused without owner info");

    let indexRefused = false;
    try {
      await db.insert(businessEntities).values({
        ownerUserId: userB.id,
        legalName: "Osek uniqueness B duplicate",
        osekMurshe: taken,
      });
    } catch (err) {
      indexRefused = isOsekUniqueViolation(err);
    }
    check(indexRefused, "unique index did not reject the duplicate insert");

    const [entityB] = await db
      .insert(businessEntities)
      .values({
        ownerUserId: userB.id,
        legalName: "Osek uniqueness B",
        osekMurshe: fresh,
      })
      .returning({ id: businessEntities.id });
    entityIds.push(entityB.id);
    await assertOsekMursheAvailable({
      osekMurshe: fresh,
      exceptEntityId: entityB.id,
      userId: userB.id,
    });
    console.log("db: duplicate refused, unique index held, free number saved");

    const actorId = userB.id;
    const correctedRow = await correctOsekMurshe({
      businessEntityId: entityB.id,
      raw: ` ${corrected.slice(0, 3)}-${corrected.slice(3)} `,
      actorUserId: actorId,
    });
    check(
      correctedRow.osekMurshe === corrected,
      "support correction did not store the normalized number",
    );

    await sql`
      INSERT INTO outbound_invoices (
        user_id, business_entity_id, tax_year, invoice_date,
        subtotal, total, status, invoice_number, formatted_number, sequence_number
      ) VALUES (
        ${userA.id}, ${entityA.id}, 2026, ${"2026-01-15"},
        ${"10.00"}, ${"10.00"}, ${"issued"},
        ${`osek-test-${entityA.id.slice(0, 8)}`},
        ${`2026-TI-OSEK-${entityA.id.slice(0, 8)}`},
        1
      )
    `;

    let issuedBlocked = false;
    try {
      await correctOsekMurshe({
        businessEntityId: entityA.id,
        raw: blockedTarget,
        actorUserId: actorId,
      });
    } catch (err) {
      issuedBlocked =
        err instanceof OsekMursheError &&
        err.code === "issued_documents" &&
        err.message === OSEK_ISSUED_DOCUMENTS_MESSAGE;
    }
    check(issuedBlocked, "issued entity was not blocked");
    const [still] = await db
      .select({ osekMurshe: businessEntities.osekMurshe })
      .from(businessEntities)
      .where(eq(businessEntities.id, entityA.id));
    check(still.osekMurshe === taken, "issued entity number changed");

    let supportDuplicate = false;
    try {
      await correctOsekMurshe({
        businessEntityId: entityB.id,
        raw: taken,
        actorUserId: actorId,
      });
    } catch (err) {
      supportDuplicate =
        err instanceof OsekMursheError &&
        err.message === DUPLICATE_OSEK_MESSAGE &&
        !err.message.includes(emailA);
    }
    check(supportDuplicate, "support correction onto a used number was not refused");

    const probeUser = randomUUID();
    const probeNumber = await unusedNumber(55000000);
    for (let i = 0; i < 8; i++) {
      await assertOsekMursheAvailable({
        osekMurshe: probeNumber,
        userId: probeUser,
      });
    }
    let limited = false;
    try {
      await assertOsekMursheAvailable({
        osekMurshe: probeNumber,
        userId: probeUser,
      });
    } catch (err) {
      limited =
        err instanceof OsekMursheError &&
        err.code === "rate_limited" &&
        err.message === OSEK_RATE_LIMIT_MESSAGE &&
        !err.message.includes("already registered");
    }
    check(limited, "lookup was not rate-limited");
    console.log("db: support correction, issued lock, and rate limit ok");
  } finally {
    if (entityIds.length > 0) {
      await db
        .delete(outboundInvoices)
        .where(inArray(outboundInvoices.businessEntityId, entityIds));
      await db
        .delete(auditLog)
        .where(inArray(auditLog.userId, userIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await sql.end({ timeout: 5 });
    await postgresClient.end({ timeout: 5 });
  }
}

main()
  .then(() => {
    console.log("verify-osek-uniqueness: ok");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
