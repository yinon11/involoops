"use server";

import { BOI_CURRENCIES, ensureFreshRateToIls } from "@/lib/fx/usd-ils-rate";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { uniformStructureExports } from "@/db/schema";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import { requireUniformStructureActor } from "@/lib/uniform-structure/access";
import { runUniformStructureExport } from "@/lib/uniform-structure/runner";
import { uniformStructureZipHref } from "@/lib/uniform-structure/urls";
import { listOpenAllocationDrafts, type OpenAllocationDraft } from "@/lib/outbound/open-allocation-drafts";
import { revalidatePath } from "next/cache";
import { getDictionary } from "@/lib/i18n/server";

const MAX_PERIOD_DAYS = 732; // ≈ 2 years + leap-day buffer

function makeRunId(): string {
  const today = new Date().toISOString().slice(0, 10);
  const suffix = randomBytes(3).toString("hex");
  return `ex-${today}-${suffix}`;
}

export interface RequestExportParams {
  periodStart: string;
  periodEnd: string;
}

export async function requestUniformStructureExport(
  params: RequestExportParams,
): Promise<
  | {
      runId: string;
      estimatedSeconds: number;
      alreadyRunning?: boolean;
      openDrafts: OpenAllocationDraft[];
    }
  | { error: string }
> {
  const dict = await getDictionary();
  const { userId: actorUserId, businessEntityId } =
    await requireUniformStructureActor();
  const entity = await getBusinessEntityForUser(actorUserId);
  if (entity.id !== businessEntityId) {
    return { error: dict.errors.businessEntityMismatch };
  }

  const start = new Date(`${params.periodStart}T00:00:00Z`);
  const end = new Date(`${params.periodEnd}T23:59:59Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return { error: dict.errors.invalidPeriod };
  }
  const daysRequested = Math.floor(
    (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (daysRequested > MAX_PERIOD_DAYS) {
    return { error: dict.errors.periodExceeds2Years };
  }
  // Compare by UTC date string rather than instant — "today" is a
  // valid period end even when the user clicks before 23:59:59Z.
  const todayUtcDateString = new Date().toISOString().slice(0, 10);
  if (params.periodEnd > todayUtcDateString) {
    return { error: dict.errors.periodEndInFuture };
  }

  // Concurrency guard — if a PENDING or RUNNING export already
  // exists for this business entity, piggyback on that run.
  const existing = await db
    .select()
    .from(uniformStructureExports)
    .where(
      and(
        eq(uniformStructureExports.businessEntityId, entity.id),
        inArray(uniformStructureExports.status, ["PENDING", "RUNNING"]),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return {
      runId: existing[0].runId,
      estimatedSeconds: 15,
      alreadyRunning: true,
      openDrafts: await listOpenAllocationDrafts({
        businessEntityId: entity.id,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
      }),
    };
  }

  const runId = makeRunId();
  const [inserted] = await db
    .insert(uniformStructureExports)
    .values({
      businessEntityId: entity.id,
      runId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      requestedByUserId: actorUserId,
      status: "PENDING",
    })
    .returning({ id: uniformStructureExports.id });

  // Documents issued before rates were frozen per document convert at the
  // latest stored Bank of Israel rate; load it so the export doesn't fall
  // back to a fixed one.
  await Promise.all(BOI_CURRENCIES.map((c) => ensureFreshRateToIls(c)));

  // Fire-and-forget. Production should wire this to a proper queue
  // — setImmediate is fine for the dev/MVP profile (see Spec 10
  // §KNOWN_ISSUES). We deliberately do NOT await.
  setImmediate(() => {
    runUniformStructureExport({
      exportRowId: inserted.id,
      businessEntityId: entity.id,
      periodStart: start,
      periodEnd: end,
      actorUserId,
      runId,
    }).catch((err) => {
      console.error(`[uniform-structure] runner crashed ${runId}:`, err);
    });
  });

  revalidatePath("/admin/uniform-structure");
  revalidatePath("/outbound/uniform-structure");
  return {
    runId,
    estimatedSeconds: Math.max(5, Math.floor(daysRequested / 30)),
    openDrafts: await listOpenAllocationDrafts({
      businessEntityId: entity.id,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    }),
  };
}

export type ExportStatus =
  | { status: "PENDING" | "RUNNING"; progress?: number }
  | {
      status: "DONE";
      downloadUrl: string;
      stats: Record<string, unknown>;
    }
  | { status: "FAILED"; error: string };

export async function getExportStatus(runId: string): Promise<ExportStatus> {
  const dict = await getDictionary();
  const { businessEntityId } = await requireUniformStructureActor();
  const [row] = await db
    .select()
    .from(uniformStructureExports)
    .where(eq(uniformStructureExports.runId, runId))
    .limit(1);
  if (!row || row.businessEntityId !== businessEntityId) {
    return { status: "FAILED", error: dict.errors.exportNotFound };
  }

  if (row.status === "DONE" && row.s3KeyZip) {
    return {
      status: "DONE",
      downloadUrl: uniformStructureZipHref(runId),
      stats: (row.stats as Record<string, unknown> | null) ?? {},
    };
  }
  if (row.status === "FAILED") {
    return { status: "FAILED", error: row.errorMessage ?? "unknown" };
  }
  return { status: row.status === "PENDING" ? "PENDING" : "RUNNING" };
}

export interface ExportRow {
  runId: string;
  periodStart: string;
  periodEnd: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  createdAt: string;
  completedAt: string | null;
  stats: Record<string, unknown> | null;
  errorMessage: string | null;
  zipKey: string | null;
}

export async function listMyUniformStructureExports(): Promise<ExportRow[]> {
  const { businessEntityId } = await requireUniformStructureActor();
  const rows = await db
    .select()
    .from(uniformStructureExports)
    .where(eq(uniformStructureExports.businessEntityId, businessEntityId))
    .orderBy(desc(uniformStructureExports.createdAt))
    .limit(100);
  return rows.map((r) => ({
    runId: r.runId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    stats: (r.stats as Record<string, unknown> | null) ?? null,
    errorMessage: r.errorMessage,
    zipKey: r.s3KeyZip,
  }));
}

export async function getExportDownloadUrl(
  runId: string,
): Promise<{ url: string } | { error: string }> {
  const dict = await getDictionary();
  const { businessEntityId } = await requireUniformStructureActor();
  const [row] = await db
    .select()
    .from(uniformStructureExports)
    .where(eq(uniformStructureExports.runId, runId))
    .limit(1);
  if (!row || row.businessEntityId !== businessEntityId || !row.s3KeyZip) {
    return { error: dict.errors.exportNotReady };
  }
  return { url: uniformStructureZipHref(runId) };
}
