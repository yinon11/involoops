"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import { businessEntities } from "@/db/schema";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { deleteFile, uploadFile } from "@/lib/storage";
import {
  assertWithholdingCertificatePdf,
  certificateDownloadName,
  withholdingCertificateObjectKey,
} from "@/lib/documents/withholding-certificate";

export type WithholdingCertificateError =
  | "unauthorized"
  | "no_entity"
  | "empty"
  | "not_pdf"
  | "too_large"
  | "invalid_date";

export type WithholdingCertificateResult =
  | { ok: true }
  | { ok: false; error: WithholdingCertificateError };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireEditableEntity(): Promise<
  | { entity: NonNullable<Awaited<ReturnType<typeof getBusinessEntityForUserOrNull>>> }
  | { error: WithholdingCertificateError }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: "unauthorized" as const };
  const entity = await getBusinessEntityForUserOrNull(userId);
  if (!entity) return { error: "no_entity" as const };
  await requirePermission({
    userId,
    businessEntityId: entity.id,
    permission: PERMISSIONS.BUSINESS_ENTITY_EDIT,
    route: "withholdingCertificate",
  });
  return { entity };
}

function revalidate() {
  revalidatePath("/creator/business-details");
  revalidatePath("/outbound/new");
}

export async function uploadWithholdingCertificate(
  formData: FormData,
): Promise<WithholdingCertificateResult> {
  const gate = await requireEditableEntity();
  if ("error" in gate) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "empty" };
  const buffer = Buffer.from(await file.arrayBuffer());
  const problem = assertWithholdingCertificatePdf(buffer);
  if (problem) return { ok: false, error: problem };

  const key = withholdingCertificateObjectKey(gate.entity.ownerUserId);
  await uploadFile(buffer, key, "application/pdf");
  if (
    gate.entity.withholdingCertificateKey &&
    gate.entity.withholdingCertificateKey !== key
  ) {
    await deleteFile(gate.entity.withholdingCertificateKey).catch(() => undefined);
  }

  await db
    .update(businessEntities)
    .set({
      withholdingCertificateKey: key,
      withholdingCertificateFilename: certificateDownloadName(file.name),
      withholdingCertificateUploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(businessEntities.id, gate.entity.id));

  revalidate();
  return { ok: true };
}

export async function removeWithholdingCertificate(): Promise<WithholdingCertificateResult> {
  const gate = await requireEditableEntity();
  if ("error" in gate) return { ok: false, error: gate.error };

  if (gate.entity.withholdingCertificateKey) {
    await deleteFile(gate.entity.withholdingCertificateKey).catch(() => undefined);
  }

  await db
    .update(businessEntities)
    .set({
      withholdingCertificateKey: null,
      withholdingCertificateFilename: null,
      withholdingCertificateUploadedAt: null,
      withholdingCertificateValidUntil: null,
      attachWithholdingCertificate: false,
      updatedAt: new Date(),
    })
    .where(eq(businessEntities.id, gate.entity.id));

  revalidate();
  return { ok: true };
}

export async function updateWithholdingCertificateSettings(input: {
  attach: boolean;
  validUntil: string;
}): Promise<WithholdingCertificateResult> {
  const gate = await requireEditableEntity();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!gate.entity.withholdingCertificateKey) {
    return { ok: false, error: "empty" };
  }

  const validUntil = input.validUntil.trim();
  if (validUntil && !DATE_RE.test(validUntil)) {
    return { ok: false, error: "invalid_date" };
  }

  await db
    .update(businessEntities)
    .set({
      attachWithholdingCertificate: input.attach,
      withholdingCertificateValidUntil: validUntil || null,
      updatedAt: new Date(),
    })
    .where(eq(businessEntities.id, gate.entity.id));

  revalidate();
  return { ok: true };
}
