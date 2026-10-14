"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { OsekMursheError } from "@/lib/business-entity/osek-number";
import { correctOsekMurshe } from "@/lib/business-entity/osek-uniqueness";

const INPUT = z.object({
  businessEntityId: z.string().uuid(),
  osekMurshe: z.string().min(1),
});

/**
 * Support-only correction of a business number.
 * Refuses issued entities, invalid numbers, and numbers already in use.
 * The error never names the other account.
 */
export async function correctBusinessEntityTaxId(input: {
  businessEntityId: string;
  osekMurshe: string;
}): Promise<{ ok: true; osekMurshe: string } | { ok: false; error: string }> {
  const session = await auth();
  const adminId = session?.user?.id;
  if (!adminId) return { ok: false, error: "Unauthorized" };
  if (!(await isUserAdmin(adminId))) {
    return { ok: false, error: "Admin access required" };
  }

  const parsed = INPUT.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid business entity or tax id" };
  }

  try {
    const result = await correctOsekMurshe({
      businessEntityId: parsed.data.businessEntityId,
      raw: parsed.data.osekMurshe,
      actorUserId: adminId,
    });
    return { ok: true, osekMurshe: result.osekMurshe };
  } catch (err) {
    if (err instanceof OsekMursheError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof Error && err.message === "Business entity not found") {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
