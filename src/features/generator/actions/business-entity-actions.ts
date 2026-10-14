"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  businessEntities,
  businessEntityMembers,
} from "@/db/schema";
import {
  ENTITY_TYPES,
  type BusinessEntityAddress,
  type EntityType,
} from "@/db/schema/business-entities";
import {
  getBusinessEntityForUserOrNull,
  type BusinessEntityRow,
} from "@/lib/rbac/current-business-entity";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS, ROLE_PRESETS } from "@/lib/rbac/permissions";
import { resetReadinessOnOsekMursheChange } from "@/lib/shaam/tenant-readiness";
import {
  assertIdentityLock,
  EntityIdentityLockedError,
} from "@/lib/business-entity/identity";
import {
  DUPLICATE_OSEK_MESSAGE,
  OsekMursheError,
  canonicalOsekMurshe,
  normalizeOsekMurshe,
} from "@/lib/business-entity/osek-number";
import {
  assertOsekMursheAvailable,
  isOsekUniqueViolation,
} from "@/lib/business-entity/osek-uniqueness";
import { revalidatePath } from "next/cache";

const ADDRESS_SCHEMA = z
  .object({
    street: z.string().optional(),
    city: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  })
  .optional();

const UPDATE_SCHEMA = z.object({
  legalName: z.string().trim().min(1, "Legal name is required"),
  legalNameEn: z.string().trim().optional().or(z.literal("")),
  osekMurshe: z.string().optional(),
  entityType: z.enum(ENTITY_TYPES as unknown as [EntityType, ...EntityType[]]),
  address: ADDRESS_SCHEMA,
  phone: z.string().trim().optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || /.+@.+\..+/.test(v),
      { message: "Invalid email address" },
    ),
  taxYearStartsMonth: z.number().int().min(1).max(12),
  defaultVatInclusive: z.boolean().optional(),
});

export type BusinessEntityUpdateInput = z.infer<typeof UPDATE_SCHEMA>;

export type UpdateBusinessEntityResult =
  | { ok: true; entity: BusinessEntityRow }
  | { ok: false; error: string };

function userFacingOsekError(err: unknown): string | null {
  if (err instanceof OsekMursheError) return err.message;
  if (isOsekUniqueViolation(err)) return DUPLICATE_OSEK_MESSAGE;
  return null;
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

/**
 * Resolve the caller's business entity, or `null` if they have not
 * yet completed the first-time setup at /creator/business-details.
 *
 * Used to seed the form on `/creator/business-details`. The form is
 * the only path that can transition a user from "no entity" to
 * "entity exists" (via `updateMyBusinessEntity`).
 */
export async function getMyBusinessEntity(): Promise<BusinessEntityRow | null> {
  const userId = await requireUserId();
  return getBusinessEntityForUserOrNull(userId);
}

/**
 * Upsert the caller's business entity.
 *
 *   - First call (no row exists): INSERT a new `business_entities`
 *     row owned by the caller, plus an OWNER membership in the same
 *     transaction. RBAC permission checks are skipped on this branch
 *     because the user is creating the very entity they will own.
 *   - Subsequent calls: UPDATE the existing row, enforcing the
 *     identity lock for `osekMurshe` / `entityType`. Requires
 *     `BUSINESS_ENTITY_EDIT`.
 */
export async function updateMyBusinessEntity(
  input: BusinessEntityUpdateInput,
): Promise<UpdateBusinessEntityResult> {
  const userId = await requireUserId();
  const parsed = UPDATE_SCHEMA.parse(input);

  const address: BusinessEntityAddress | null = parsed.address
    ? {
        street: parsed.address.street || undefined,
        city: parsed.address.city || undefined,
        zip: parsed.address.zip || undefined,
        country: parsed.address.country || undefined,
      }
    : null;

  let newOsekMurshe: string | null;
  try {
    newOsekMurshe = normalizeOsekMurshe(parsed.osekMurshe);
  } catch (err) {
    const message = userFacingOsekError(err);
    if (message) return { ok: false, error: message };
    throw err;
  }
  const existing = await getBusinessEntityForUserOrNull(userId);

  // First-time setup — INSERT entity + OWNER membership atomically.
  if (!existing) {
    if (newOsekMurshe) {
      try {
        await assertOsekMursheAvailable({
          osekMurshe: newOsekMurshe,
          userId,
        });
      } catch (err) {
        const message = userFacingOsekError(err);
        if (message) return { ok: false, error: message };
        throw err;
      }
    }

    let inserted: BusinessEntityRow;
    try {
      inserted = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(businessEntities)
          .values({
            ownerUserId: userId,
            legalName: parsed.legalName,
            legalNameEn: parsed.legalNameEn || null,
            osekMurshe: newOsekMurshe,
            entityType: parsed.entityType,
            address,
            phone: parsed.phone || null,
            email: parsed.email || null,
            taxYearStartsMonth: parsed.taxYearStartsMonth,
            defaultVatInclusive: parsed.defaultVatInclusive ?? true,
          })
          .returning();

        await tx.insert(businessEntityMembers).values({
          businessEntityId: row.id,
          userId,
          role: "OWNER",
          permissions: ROLE_PRESETS.OWNER,
        });

        return row;
      });
    } catch (err) {
      const message = userFacingOsekError(err);
      if (message) return { ok: false, error: message };
      throw err;
    }

    revalidatePath("/creator/business-details");
    revalidatePath("/settings/ita-integration");
    revalidatePath("/money-in");
    return { ok: true, entity: inserted };
  }

  // Existing entity — enforce permissions + identity lock.
  await requirePermission({
    userId,
    businessEntityId: existing.id,
    permission: PERMISSIONS.BUSINESS_ENTITY_EDIT,
    route: "updateMyBusinessEntity",
  });

  const currentOsek = canonicalOsekMurshe(existing.osekMurshe);
  const osekMursheChanged = currentOsek !== newOsekMurshe;

  // Enforce the identity lock — once any of the core issuer fields
  // have been saved once, they cannot be mutated. Contact fields
  // (phone, email, legalNameEn, taxYearStartsMonth) remain mutable.
  // Support corrections go through `correctOsekMurshe`, not this action.
  try {
    assertIdentityLock(
      {
        legalName: existing.legalName,
        osekMurshe: currentOsek,
        entityType: existing.entityType,
        address: existing.address,
      },
      {
        legalName: parsed.legalName,
        osekMurshe: newOsekMurshe,
        entityType: parsed.entityType,
        address,
      },
    );
  } catch (err) {
    if (err instanceof EntityIdentityLockedError) {
      return {
        ok: false,
        error:
          `Identity field "${err.field}" is locked. ` +
          `Contact support to correct a mistake in your business details.`,
      };
    }
    throw err;
  }

  if (newOsekMurshe && osekMursheChanged) {
    try {
      await assertOsekMursheAvailable({
        osekMurshe: newOsekMurshe,
        exceptEntityId: existing.id,
        userId,
      });
    } catch (err) {
      const message = userFacingOsekError(err);
      if (message) return { ok: false, error: message };
      throw err;
    }
  }

  let updated: BusinessEntityRow;
  try {
    const [row] = await db
      .update(businessEntities)
      .set({
        legalName: parsed.legalName,
        legalNameEn: parsed.legalNameEn || null,
        osekMurshe: newOsekMurshe,
        entityType: parsed.entityType,
        address,
        phone: parsed.phone || null,
        email: parsed.email || null,
        taxYearStartsMonth: parsed.taxYearStartsMonth,
        defaultVatInclusive:
          parsed.defaultVatInclusive ?? existing.defaultVatInclusive,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, existing.id))
      .returning();
    updated = row;
  } catch (err) {
    const message = userFacingOsekError(err);
    if (message) return { ok: false, error: message };
    throw err;
  }

  // Spec 09 — an osek_murshe change invalidates the existing gov.il
  // authorization context (the grant is scoped to the 9-digit number),
  // so we reset the self-report flags and revoke any ACTIVE row.
  if (osekMursheChanged) {
    try {
      await resetReadinessOnOsekMursheChange({
        businessEntityId: existing.id,
        actorUserId: userId,
      });
    } catch (err) {
      console.error(
        `[business-entity] readiness reset failed for ${existing.id}:`,
        err,
      );
    }
  }

  revalidatePath("/creator/business-details");
  revalidatePath("/settings/ita-integration");
  return { ok: true, entity: updated };
}
