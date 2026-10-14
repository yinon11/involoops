"use server";

import { BOI_CURRENCIES, ensureFreshRateToIls } from "@/lib/fx/usd-ils-rate";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import { moveinExportSettings, moveinExports } from "@/db/schema";
import { runMoveinExport } from "@/lib/hashavshevet-movein/runner";
import type { MoveinMethod } from "@/lib/hashavshevet-movein/types";
import { isMoveinMethod } from "@/lib/hashavshevet-movein/settings-mapper";
import { requirePermission } from "@/lib/rbac/authorize";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getDictionary } from "@/lib/i18n/server";
import {
  listOpenAllocationDrafts,
  type OpenAllocationDraft,
} from "@/lib/outbound/open-allocation-drafts";

const MAX_PERIOD_DAYS = 732;
const MOVEIN_SETTINGS_PATH = "/outbound/hashavshevet";
const MOVEIN_EXPORT_PATH = "/outbound/hashavshevet/export";

async function requireMoveinActor(): Promise<{
  userId: string;
  businessEntityId: string;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;
  const entity = await getBusinessEntityForUser(userId);
  await requirePermission({
    userId,
    businessEntityId: entity.id,
    permission: PERMISSIONS.EXPORT_UNIFORM_STRUCTURE,
    route: "moveinExport",
  });
  return { userId, businessEntityId: entity.id };
}

function defaultSettingsValues(businessEntityId: string) {
  return {
    businessEntityId,
    exportEmail: null as string | null,
    method: "detailed" as const,
  };
}

export type MoveinSettingsDto = {
  exportEmail: string;
  method: MoveinMethod;
  generalCash: string;
  creditCardCash: string;
  cash: string;
  checkCash: string;
  transferUsd: string;
  transferEur: string;
  transferGbp: string;
  transferJpy: string;
  paypal: string;
  bit: string;
  pepper: string;
  credit: string;
  purchase: string;
  inputVat: string;
  withholdingTax: string;
  outputVat: string;
  income: string;
  exemptIncome: string;
  cashCustomer: string;
};

function rowToDto(row: typeof moveinExportSettings.$inferSelect): MoveinSettingsDto {
  return {
    exportEmail: row.exportEmail ?? "",
    method: isMoveinMethod(row.method) ? row.method : "detailed",
    generalCash: row.generalCash,
    creditCardCash: row.creditCardCash,
    cash: row.cash,
    checkCash: row.checkCash,
    transferUsd: row.transferUsd,
    transferEur: row.transferEur,
    transferGbp: row.transferGbp,
    transferJpy: row.transferJpy,
    paypal: row.paypal,
    bit: row.bit,
    pepper: row.pepper,
    credit: row.credit,
    purchase: row.purchase,
    inputVat: row.inputVat,
    withholdingTax: row.withholdingTax,
    outputVat: row.outputVat,
    income: row.income,
    exemptIncome: row.exemptIncome,
    cashCustomer: row.cashCustomer,
  };
}

export async function getMoveinExportSettings(): Promise<MoveinSettingsDto> {
  const { businessEntityId } = await requireMoveinActor();

  const existing = await db.query.moveinExportSettings.findFirst({
    where: eq(moveinExportSettings.businessEntityId, businessEntityId),
  });

  if (existing) {
    return rowToDto(existing);
  }

  const [inserted] = await db
    .insert(moveinExportSettings)
    .values(defaultSettingsValues(businessEntityId))
    .returning();

  return rowToDto(inserted);
}

export async function saveMoveinExportSettings(
  input: MoveinSettingsDto,
): Promise<{ success: true } | { error: string }> {
  const { businessEntityId } = await requireMoveinActor();

  const method = isMoveinMethod(input.method) ? input.method : "detailed";
  const now = new Date();

  const values = {
    exportEmail: input.exportEmail.trim() || null,
    method,
    generalCash: input.generalCash.trim() || "0",
    creditCardCash: input.creditCardCash.trim() || "0",
    cash: input.cash.trim() || "0",
    checkCash: input.checkCash.trim() || "0",
    transferUsd: input.transferUsd.trim() || "0",
    transferEur: input.transferEur.trim() || "0",
    transferGbp: input.transferGbp.trim() || "0",
    transferJpy: input.transferJpy.trim() || "0",
    paypal: input.paypal.trim() || "0",
    bit: input.bit.trim() || "0",
    pepper: input.pepper.trim() || "0",
    credit: input.credit.trim() || "0",
    purchase: input.purchase.trim() || "0",
    inputVat: input.inputVat.trim() || "0",
    withholdingTax: input.withholdingTax.trim() || "0",
    outputVat: input.outputVat.trim() || "0",
    income: input.income.trim() || "0",
    exemptIncome: input.exemptIncome.trim() || "0",
    cashCustomer: input.cashCustomer.trim() || "0",
    updatedAt: now,
  };

  await db
    .insert(moveinExportSettings)
    .values({
      businessEntityId,
      ...values,
    })
    .onConflictDoUpdate({
      target: moveinExportSettings.businessEntityId,
      set: values,
    });

  revalidatePath(MOVEIN_SETTINGS_PATH);
  revalidatePath(MOVEIN_EXPORT_PATH);
  return { success: true };
}

export async function requestMoveinExport(params: {
  periodStart: string;
  periodEnd: string;
}): Promise<
  | {
      runId: string;
      movementCount: number;
      invoiceCount: number;
      openDrafts: OpenAllocationDraft[];
    }
  | { error: string; openDrafts?: OpenAllocationDraft[] }
> {
  const dict = await getDictionary();
  const { userId, businessEntityId } = await requireMoveinActor();

  const start = new Date(`${params.periodStart}T00:00:00Z`);
  const end = new Date(`${params.periodEnd}T23:59:59Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: dict.errors.invalidPeriodDates };
  }
  if (end < start) {
    return { error: dict.errors.endBeforeStart };
  }

  const todayUtc = new Date().toISOString().slice(0, 10);
  if (params.periodEnd > todayUtc) {
    return { error: dict.errors.endInFuture };
  }

  const settings = await db.query.moveinExportSettings.findFirst({
    where: eq(moveinExportSettings.businessEntityId, businessEntityId),
  });
  if (!settings) {
    return { error: dict.errors.configureCardMapping };
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  if (days > MAX_PERIOD_DAYS) {
    return { error: dict.errors.periodExceedsTwoYears };
  }

  // Documents issued before rates were frozen per document convert at the
  // latest stored Bank of Israel rate; load it so the export doesn't fall
  // back to a fixed one.
  await Promise.all(BOI_CURRENCIES.map((c) => ensureFreshRateToIls(c)));

  const result = await runMoveinExport({
    businessEntityId,
    actorUserId: userId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    settings,
  });

  const openDrafts = await listOpenAllocationDrafts({
    businessEntityId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
  });

  if ("error" in result) {
    return { error: result.error, openDrafts };
  }

  revalidatePath(MOVEIN_EXPORT_PATH);
  return { ...result, openDrafts };
}

export async function listMoveinExports() {
  const { businessEntityId } = await requireMoveinActor();

  const rows = await db
    .select()
    .from(moveinExports)
    .where(eq(moveinExports.businessEntityId, businessEntityId))
    .orderBy(desc(moveinExports.createdAt))
    .limit(50);

  return rows.map((r) => ({
    runId: r.runId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    status: r.status,
    movementCount: r.movementCount,
    invoiceCount: r.invoiceCount,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt?.toISOString() ?? null,
    downloadHref:
      r.status === "DONE" && r.s3KeyZip
        ? `/api/files/movein/${encodeURIComponent(r.runId)}`
        : null,
  }));
}

/** Verify the signed-in user may download a specific export run. */
export async function canDownloadMoveinExport(runId: string): Promise<boolean> {
  try {
    const { businessEntityId } = await requireMoveinActor();
    const [row] = await db
      .select({ businessEntityId: moveinExports.businessEntityId })
      .from(moveinExports)
      .where(
        and(
          eq(moveinExports.runId, runId),
          eq(moveinExports.businessEntityId, businessEntityId),
        ),
      )
      .limit(1);
    return Boolean(row);
  } catch {
    return false;
  }
}
