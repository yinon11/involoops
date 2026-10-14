"use server";

/*
 * SHAAM actions (Spec 07 / Spec 09).
 *
 * Listing, reminders, and the sandbox mock stay platform-admin only.
 * Granting, renewing, testing, and disconnecting an ITA authorization is
 * open to anyone with `ita_integration:manage` on that business (the
 * owner and their accountant). Issuing documents stays behind
 * `canIssueOutboundDocument` until Form 513 approval.
 */

import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { db } from "@/db";
import {
  businessEntities,
  shaamAuthorizations,
  shaamTokenEvents,
} from "@/db/schema";
import type {
  ShaamAuthorizationStatus,
  ShaamEnvironment,
} from "@/db/schema/shaam-authorizations";
import type { ShaamTokenEventType } from "@/db/schema/shaam-token-events";
import {
  getActiveAccessToken,
  initiateAuthorization,
  revokeAuthorization,
} from "@/lib/shaam/authorization";
import { getShaamConfig } from "@/lib/shaam/client";
import {
  ShaamApiError,
  ShaamAuthorizationError,
} from "@/lib/shaam/errors";
import {
  getTenantReadiness,
  setReadinessStep,
  setSupportContact,
  saveReadinessNotes as saveNotesInternal,
  type ReadinessSnapshot,
} from "@/lib/shaam/tenant-readiness";
import { sendReadinessStuckReminder } from "@/lib/shaam/notifications";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import {
  isSandboxStack,
  readSandboxMockSetting,
  writeSandboxMockSetting,
} from "@/lib/shaam/sandbox-mock-outcome";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!(await isUserAdmin(session.user.id))) throw new Error("Forbidden");
  return session.user.id;
}

/**
 * Caller may manage this business's ITA grant. Platform admins pass so
 * the admin screen can still act on any entity. Everyone else needs
 * `ita_integration:manage` on that exact business.
 */
async function requireItaIntegrationManager(
  businessEntityId: string,
  route: string,
): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  await requirePermission({
    userId: session.user.id,
    businessEntityId,
    permission: PERMISSIONS.ITA_INTEGRATION_MANAGE,
    route,
  });
  return session.user.id;
}

export interface ShaamAuthorizationRow {
  businessEntityId: string;
  legalName: string;
  osekMurshe: string | null;
  environment: ShaamEnvironment;
  status: ShaamAuthorizationStatus;
  refreshTokenExpiresAt: string | null;
  accessTokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
}

export async function listShaamAuthorizations(params: {
  environment?: ShaamEnvironment;
} = {}): Promise<ShaamAuthorizationRow[]> {
  await requireAdmin();
  const environment = params.environment ?? getShaamConfig().environment;

  const rows = await db
    .select({
      businessEntityId: businessEntities.id,
      legalName: businessEntities.legalName,
      osekMurshe: businessEntities.osekMurshe,
      environment: shaamAuthorizations.environment,
      status: shaamAuthorizations.status,
      refreshTokenExpiresAt: shaamAuthorizations.refreshTokenExpiresAt,
      accessTokenExpiresAt: shaamAuthorizations.accessTokenExpiresAt,
      lastRefreshedAt: shaamAuthorizations.lastRefreshedAt,
      lastErrorCode: shaamAuthorizations.lastErrorCode,
      lastErrorMessage: shaamAuthorizations.lastErrorMessage,
      lastErrorAt: shaamAuthorizations.lastErrorAt,
    })
    .from(businessEntities)
    .leftJoin(
      shaamAuthorizations,
      and(
        eq(shaamAuthorizations.businessEntityId, businessEntities.id),
        eq(shaamAuthorizations.environment, environment),
      ),
    )
    .orderBy(businessEntities.legalName);

  return rows.map((r) => ({
    businessEntityId: r.businessEntityId,
    legalName: r.legalName,
    osekMurshe: r.osekMurshe,
    environment: (r.environment ?? environment) as ShaamEnvironment,
    status: (r.status ?? "PENDING") as ShaamAuthorizationStatus,
    refreshTokenExpiresAt: r.refreshTokenExpiresAt?.toISOString() ?? null,
    accessTokenExpiresAt: r.accessTokenExpiresAt?.toISOString() ?? null,
    lastRefreshedAt: r.lastRefreshedAt?.toISOString() ?? null,
    lastErrorCode: r.lastErrorCode,
    lastErrorMessage: r.lastErrorMessage,
    lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
  }));
}

export async function startShaamAuthorization(params: {
  businessEntityId: string;
  environment?: ShaamEnvironment;
}): Promise<{ authorizationUrl: string }> {
  const userId = await requireItaIntegrationManager(
    params.businessEntityId,
    "startShaamAuthorization",
  );
  const result = await initiateAuthorization({
    businessEntityId: params.businessEntityId,
    actorUserId: userId,
    environment: params.environment,
  });
  return { authorizationUrl: result.authorizationUrl };
}

export async function revokeShaamAuthorization(params: {
  businessEntityId: string;
  environment?: ShaamEnvironment;
}): Promise<{ success: true }> {
  const userId = await requireItaIntegrationManager(
    params.businessEntityId,
    "revokeShaamAuthorization",
  );
  await revokeAuthorization({
    businessEntityId: params.businessEntityId,
    actorUserId: userId,
    environment: params.environment,
  });
  return { success: true };
}

export async function testShaamConnection(params: {
  businessEntityId: string;
  environment?: ShaamEnvironment;
}): Promise<
  | { ok: true; accessTokenPrefix: string }
  | { ok: false; reason: string; detail?: string }
> {
  await requireItaIntegrationManager(
    params.businessEntityId,
    "testShaamConnection",
  );
  try {
    const token = await getActiveAccessToken({
      businessEntityId: params.businessEntityId,
      environment: params.environment,
    });
    return { ok: true, accessTokenPrefix: token.slice(0, 6) + "…" };
  } catch (err) {
    if (err instanceof ShaamAuthorizationError) {
      return { ok: false, reason: err.reason };
    }
    if (err instanceof ShaamApiError) {
      return {
        ok: false,
        reason: err.itaErrorCode ?? `http_${err.httpStatus}`,
        detail: err.itaMessage ?? undefined,
      };
    }
    return {
      ok: false,
      reason: "unknown",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ShaamTokenEventRow {
  id: string;
  createdAt: string;
  eventType: ShaamTokenEventType;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export async function listShaamTokenEvents(params: {
  businessEntityId: string;
  environment?: ShaamEnvironment;
  limit?: number;
}): Promise<ShaamTokenEventRow[]> {
  await requireAdmin();
  const environment = params.environment ?? getShaamConfig().environment;
  const rows = await db
    .select()
    .from(shaamTokenEvents)
    .where(
      and(
        eq(shaamTokenEvents.businessEntityId, params.businessEntityId),
        eq(shaamTokenEvents.environment, environment),
      ),
    )
    .orderBy(desc(shaamTokenEvents.createdAt))
    .limit(Math.min(params.limit ?? 50, 200));
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    eventType: r.eventType as ShaamTokenEventType,
    httpStatus: r.httpStatus,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
}

// --- Spec 09: tenant readiness actions ------------------------------------

async function requireCallerEntity(): Promise<{
  userId: string;
  businessEntityId: string;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const entity = await getBusinessEntityForUser(session.user.id);
  return { userId: session.user.id, businessEntityId: entity.id };
}

export async function getReadinessForCurrentUser(): Promise<ReadinessSnapshot> {
  const caller = await requireCallerEntity();
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.ITA_INTEGRATION_MANAGE,
    route: "getReadinessForCurrentUser",
  });
  return getTenantReadiness(caller.businessEntityId);
}

export async function confirmReadinessStep(params: {
  step: "azorIshi" | "taagid" | "morsheAl";
  confirmed: boolean;
}): Promise<void> {
  const caller = await requireCallerEntity();
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.ITA_INTEGRATION_MANAGE,
    route: "confirmReadinessStep",
  });
  await setReadinessStep({
    businessEntityId: caller.businessEntityId,
    step: params.step,
    confirmed: params.confirmed,
    confirmedByUserId: caller.userId,
  });
  revalidatePath("/settings/ita-integration");
}

export async function updateSupportContact(params: {
  email?: string;
  phone?: string;
}): Promise<void> {
  const caller = await requireCallerEntity();
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.ITA_INTEGRATION_MANAGE,
    route: "updateSupportContact",
  });
  await setSupportContact({
    businessEntityId: caller.businessEntityId,
    email: params.email?.trim() || null,
    phone: params.phone?.trim() || null,
  });
  revalidatePath("/settings/ita-integration");
}

export async function saveReadinessNotes(notes: string): Promise<void> {
  const caller = await requireCallerEntity();
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.ITA_INTEGRATION_MANAGE,
    route: "saveReadinessNotes",
  });
  await saveNotesInternal(caller.businessEntityId, notes);
  revalidatePath("/settings/ita-integration");
}

/**
 * Admin-only — fires a one-off stuck-onboarding reminder email to a
 * specific tenant. Used by the row-level "Send reminder" button on
 * the /admin/shaam page.
 */
export async function sendStuckReminderForEntity(
  businessEntityId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    await sendReadinessStuckReminder(businessEntityId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Admin view — list per-entity readiness state alongside the
 * authorization status already surfaced by
 * `listShaamAuthorizations`. Separate server call so existing
 * callers don't pay the extra query.
 */
export async function listReadinessStates(): Promise<
  Array<{
    businessEntityId: string;
    state: ReadinessSnapshot["state"];
    nextActionKind: ReadinessSnapshot["nextAction"]["kind"];
    lastConfirmedAt: string | null;
    supportContactEmail: string | null;
  }>
> {
  await requireAdmin();
  const ents = await db
    .select({ id: businessEntities.id })
    .from(businessEntities)
    .orderBy(businessEntities.legalName);
  const rows = await Promise.all(
    ents.map(async (e) => {
      try {
        const snap = await getTenantReadiness(e.id);
        return {
          businessEntityId: e.id,
          state: snap.state,
          nextActionKind: snap.nextAction.kind,
          lastConfirmedAt: snap.lastConfirmedAt?.toISOString() ?? null,
          supportContactEmail: snap.supportContactEmail,
        };
      } catch {
        return {
          businessEntityId: e.id,
          state: "GOV_SETUP_REQUIRED" as const,
          nextActionKind: "FILL_OSEK_MURSHE" as const,
          lastConfirmedAt: null,
          supportContactEmail: null,
        };
      }
    }),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Sandbox only: force the Tax Authority's answer (testing)
// ---------------------------------------------------------------------------

export interface SandboxMockSettingView {
  /** "" = normal. */
  value: string;
  updatedAt: string | null;
}

/** Null off the sandbox stack — the admin panel then shows nothing. */
export async function getSandboxMockSetting(): Promise<SandboxMockSettingView | null> {
  await requireAdmin();
  if (!isSandboxStack()) return null;
  const setting = await readSandboxMockSetting();
  if (!setting) return null;
  return {
    value: setting.value,
    updatedAt: setting.updatedAt?.toISOString() ?? null,
  };
}

export async function setSandboxMockSetting(
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireAdmin();
  const result = await writeSandboxMockSetting({ value, userId });
  if (result.ok) revalidatePath("/admin/shaam");
  return result;
}
