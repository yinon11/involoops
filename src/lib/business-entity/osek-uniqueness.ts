import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, businessEntities, outboundInvoices } from "@/db/schema";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resetReadinessOnOsekMursheChange } from "@/lib/shaam/tenant-readiness";
import {
  DUPLICATE_OSEK_MESSAGE,
  OSEK_ISSUED_DOCUMENTS_MESSAGE,
  OSEK_RATE_LIMIT_MESSAGE,
  OsekMursheError,
  canonicalOsekMurshe,
  normalizeOsekMurshe,
} from "./osek-number";

/** Slows guessing which numbers are already on InvoLoops. Keyed by user. */
const OSEK_LOOKUP_MAX = 8;
const OSEK_LOOKUP_WINDOW_SEC = 15 * 60;

type QueryError = {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  cause?: QueryError;
};

export function isOsekUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const row = current as QueryError;
    const constraint = row.constraint ?? row.constraint_name;
    if (
      row.code === "23505" &&
      constraint === "business_entities_osek_murshe_unique"
    ) {
      return true;
    }
    current = row.cause;
  }
  return false;
}

/**
 * Refuse a number another entity already holds.
 * The error text never includes the other entity, its owner, or its email.
 * The lookup is rate-limited per user so the answer cannot be enumerated.
 */
export async function assertOsekMursheAvailable(params: {
  osekMurshe: string;
  exceptEntityId?: string;
  userId: string;
}): Promise<void> {
  const limit = await enforceRateLimit(
    `osek-lookup:${params.userId}`,
    OSEK_LOOKUP_MAX,
    OSEK_LOOKUP_WINDOW_SEC,
  );
  if (!limit.ok) {
    throw new OsekMursheError("rate_limited", OSEK_RATE_LIMIT_MESSAGE);
  }

  const filters = [eq(businessEntities.osekMurshe, params.osekMurshe)];
  if (params.exceptEntityId) {
    filters.push(ne(businessEntities.id, params.exceptEntityId));
  }
  const [taken] = await db
    .select({ id: businessEntities.id })
    .from(businessEntities)
    .where(and(...filters))
    .limit(1);
  if (taken) {
    throw new OsekMursheError("duplicate", DUPLICATE_OSEK_MESSAGE);
  }
}

export async function entityHasNonDraftDocuments(
  businessEntityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: outboundInvoices.id })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, businessEntityId),
        ne(outboundInvoices.status, "draft"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Support correction. The account-holder form stays locked.
 * Allowed only when every document is still a draft (or there are none),
 * and only onto a valid number no other entity holds.
 */
export async function correctOsekMurshe(params: {
  businessEntityId: string;
  raw: string;
  actorUserId: string;
}): Promise<{ osekMurshe: string }> {
  const next = normalizeOsekMurshe(params.raw);
  if (!next) {
    throw new OsekMursheError("invalid_format", "A business number is required.");
  }

  const [entity] = await db
    .select({
      id: businessEntities.id,
      osekMurshe: businessEntities.osekMurshe,
    })
    .from(businessEntities)
    .where(eq(businessEntities.id, params.businessEntityId))
    .limit(1);
  if (!entity) {
    throw new Error("Business entity not found");
  }

  const current = canonicalOsekMurshe(entity.osekMurshe);
  if (current === next && entity.osekMurshe === next) {
    return { osekMurshe: next };
  }

  // A different number is a new issuer. Issued documents already carry
  // the old one, so support does not change it in the product.
  if (current !== next && (await entityHasNonDraftDocuments(entity.id))) {
    throw new OsekMursheError(
      "issued_documents",
      OSEK_ISSUED_DOCUMENTS_MESSAGE,
    );
  }

  await assertOsekMursheAvailable({
    osekMurshe: next,
    exceptEntityId: entity.id,
    userId: params.actorUserId,
  });

  try {
    await db
      .update(businessEntities)
      .set({ osekMurshe: next, updatedAt: new Date() })
      .where(eq(businessEntities.id, entity.id));
  } catch (err) {
    if (isOsekUniqueViolation(err)) {
      throw new OsekMursheError("duplicate", DUPLICATE_OSEK_MESSAGE);
    }
    throw err;
  }

  try {
    await resetReadinessOnOsekMursheChange({
      businessEntityId: entity.id,
      actorUserId: params.actorUserId,
    });
  } catch (err) {
    console.error(
      `[business-entity] readiness reset failed for ${entity.id}:`,
      err,
    );
  }

  try {
    await db.insert(auditLog).values({
      userId: params.actorUserId,
      action: "osek_murshe_corrected",
      details: {
        businessEntityId: entity.id,
        from: entity.osekMurshe,
        to: next,
      },
    });
  } catch (err) {
    console.error(
      `[business-entity] audit log insert failed for ${entity.id}:`,
      err,
    );
  }

  return { osekMurshe: next };
}
