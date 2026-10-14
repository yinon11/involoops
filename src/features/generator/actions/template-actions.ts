"use server";

import { db } from "@/db";
import { invoiceTemplates } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { TemplateDesignId } from "@/types/template";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export async function getTemplates() {
  const userId = await requireUserId();
  return db
    .select()
    .from(invoiceTemplates)
    .where(eq(invoiceTemplates.userId, userId))
    .orderBy(invoiceTemplates.createdAt);
}

export async function getDefaultTemplate() {
  const userId = await requireUserId();
  const row = await db.query.invoiceTemplates.findFirst({
    where: and(
      eq(invoiceTemplates.userId, userId),
      eq(invoiceTemplates.isDefault, true)
    ),
  });
  return row ?? null;
}

export async function getTemplateById(id: string) {
  const userId = await requireUserId();
  const row = await db.query.invoiceTemplates.findFirst({
    where: and(
      eq(invoiceTemplates.id, id),
      eq(invoiceTemplates.userId, userId)
    ),
  });
  return row ?? null;
}

/**
 * Writable template fields. Issuer identity (name, address, tax ID) is
 * deliberately absent: it lives on `business_entities` and is resolved
 * at render time by `buildTemplateConfig`. The matching columns on
 * `invoice_templates` are legacy and are dropped in a later release.
 *
 * `businessPhone` / `businessEmail` are *overrides* — blank means
 * "inherit the business entity's value".
 */
export type TemplateInput = {
  name?: string;
  designId?: TemplateDesignId;
  accentColor?: string;
  logoUrl?: string | null;
  businessPhone?: string;
  businessEmail?: string;
  businessWebsite?: string;
  showVatBreakdown?: boolean;
  showBankDetails?: boolean;
  bankAccountHolder?: string;
  bankName?: string;
  bankBranch?: string;
  bankAccountNumber?: string;
  bankIban?: string;
  bankSwift?: string;
  bankTransferNote?: string;
  defaultCurrency?: string;
  defaultLanguage?: string;
  isDefault?: boolean;
};

export async function upsertTemplate(data: TemplateInput, id?: string) {
  const userId = await requireUserId();

  if (id) {
    const [row] = await db
      .update(invoiceTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(invoiceTemplates.id, id), eq(invoiceTemplates.userId, userId))
      )
      .returning();
    revalidatePath("/settings");
    revalidatePath("/outbound");
    revalidatePath("/creator/template");
    return row;
  }

  if (data.isDefault !== false) {
    await db
      .update(invoiceTemplates)
      .set({ isDefault: false })
      .where(eq(invoiceTemplates.userId, userId));
  }

  const [row] = await db
    .insert(invoiceTemplates)
    .values({
      ...data,
      userId,
      isDefault: data.isDefault ?? true,
    })
    .returning();
  revalidatePath("/settings");
  revalidatePath("/outbound");
  revalidatePath("/creator/template");
  return row;
}

export async function deleteTemplate(id: string) {
  const userId = await requireUserId();
  await db
    .delete(invoiceTemplates)
    .where(
      and(eq(invoiceTemplates.id, id), eq(invoiceTemplates.userId, userId))
    );
  revalidatePath("/settings");
}
