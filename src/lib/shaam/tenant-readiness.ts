import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  businessEntities,
  shaamAuthorizations,
  shaamTenantReadiness,
} from "@/db/schema";
import type {
  ShaamAuthorizationStatus,
  ShaamEnvironment,
} from "@/db/schema/shaam-authorizations";
import { getShaamConfig } from "./client";
import { revokeAuthorization } from "./authorization";

// Spec 09 originally defined a separate NOT_STARTED state for fresh
// entities with no data. In practice it was indistinguishable from
// GOV_SETUP_REQUIRED (both produce FILL_OSEK_MURSHE), so the enum
// was collapsed to 4 states during validation.
export type ReadinessState =
  | "GOV_SETUP_REQUIRED"
  | "READY_TO_AUTHORIZE"
  | "AUTHORIZED"
  | "EXPIRED";

export type ReadinessNextAction =
  | { kind: "FILL_OSEK_MURSHE" }
  | { kind: "CONFIRM_AZOR_ISHI" }
  | { kind: "CONFIRM_TAAGID" }
  | { kind: "CONFIRM_MORSHE_AL" }
  | { kind: "START_OAUTH" }
  | { kind: "REAUTHORIZE"; reason: "expired" | "revoked" | "error" }
  | { kind: "RENEW_SOON"; daysLeft: number }
  | { kind: "NONE" };

export interface ReadinessChecklist {
  azorIshiConfirmed: boolean;
  taagidRegistered: boolean;
  morsheAlAssigned: boolean;
  osekMurshePresent: boolean;
}

export interface ReadinessSnapshot {
  state: ReadinessState;
  checklist: ReadinessChecklist;
  authorization: {
    status: ShaamAuthorizationStatus | null;
    expiresAt: Date | null;
    daysUntilExpiry: number | null;
  };
  nextAction: ReadinessNextAction;
  supportContactEmail: string | null;
  supportContactPhone: string | null;
  notes: string | null;
  lastConfirmedAt: Date | null;
  entity: {
    id: string;
    legalName: string;
    entityType: string;
    osekMurshe: string | null;
  };
}

const RENEW_WINDOW_DAYS = 14;

/**
 * Spec 09 — derives the tenant's onboarding state from three sources:
 *
 *   1. `business_entities.osekMurshe` — the only derived checklist
 *      item (the other three are self-reports because we can't probe
 *      gov.il on the tenant's behalf).
 *   2. `shaam_tenant_readiness` — the self-report row. Upserted on
 *      first call so later UPDATEs always have something to change.
 *   3. `shaam_authorizations` (current env) — the technical OAuth
 *      state.
 *
 * Pure against its inputs (the DB reads happen once inside the
 * function; given those rows, the state machine is deterministic)
 * so `scripts/verify-tenant-readiness.ts` can exercise every branch.
 */
export async function getTenantReadiness(
  businessEntityId: string,
  environment?: ShaamEnvironment,
): Promise<ReadinessSnapshot> {
  const env = environment ?? getShaamConfig().environment;

  const [entity] = await db
    .select({
      id: businessEntities.id,
      legalName: businessEntities.legalName,
      entityType: businessEntities.entityType,
      osekMurshe: businessEntities.osekMurshe,
    })
    .from(businessEntities)
    .where(eq(businessEntities.id, businessEntityId))
    .limit(1);
  if (!entity) throw new Error(`Business entity not found: ${businessEntityId}`);

  const readinessRow = await upsertReadinessRow(businessEntityId);
  const auth = await loadAuthorization(businessEntityId, env);

  const checklist: ReadinessChecklist = {
    azorIshiConfirmed: readinessRow.azorIshiConfirmed,
    // For non-corporate OSEK_MURSHE entities, taagid is auto-true —
    // they don't need תאגיד registration.
    taagidRegistered:
      readinessRow.taagidRegistered ||
      entity.entityType === "OSEK_MURSHE" ||
      entity.entityType === "OSEK_PATUR",
    morsheAlAssigned: readinessRow.morsheAlAssigned,
    osekMurshePresent: Boolean(entity.osekMurshe),
  };

  const nextAction = deriveNextAction(checklist, auth);
  const state = deriveState(checklist, auth, nextAction);

  return {
    state,
    checklist,
    authorization: auth,
    nextAction,
    supportContactEmail: readinessRow.supportContactEmail,
    supportContactPhone: readinessRow.supportContactPhone,
    notes: readinessRow.notes,
    lastConfirmedAt: readinessRow.lastConfirmedAt,
    entity,
  };
}

function deriveNextAction(
  checklist: ReadinessChecklist,
  auth: ReadinessSnapshot["authorization"],
): ReadinessNextAction {
  if (auth.status === "ACTIVE") {
    if (
      auth.daysUntilExpiry !== null &&
      auth.daysUntilExpiry <= RENEW_WINDOW_DAYS
    ) {
      return { kind: "RENEW_SOON", daysLeft: Math.max(0, auth.daysUntilExpiry) };
    }
    return { kind: "NONE" };
  }
  if (auth.status === "EXPIRED") {
    return { kind: "REAUTHORIZE", reason: "expired" };
  }
  if (auth.status === "REVOKED") {
    return { kind: "REAUTHORIZE", reason: "revoked" };
  }
  if (auth.status === "ERROR") {
    return { kind: "REAUTHORIZE", reason: "error" };
  }

  // No ACTIVE / terminal authorization row — walk the checklist.
  if (!checklist.osekMurshePresent) return { kind: "FILL_OSEK_MURSHE" };
  if (!checklist.azorIshiConfirmed) return { kind: "CONFIRM_AZOR_ISHI" };
  if (!checklist.taagidRegistered) return { kind: "CONFIRM_TAAGID" };
  if (!checklist.morsheAlAssigned) return { kind: "CONFIRM_MORSHE_AL" };
  return { kind: "START_OAUTH" };
}

function deriveState(
  checklist: ReadinessChecklist,
  auth: ReadinessSnapshot["authorization"],
  nextAction: ReadinessNextAction,
): ReadinessState {
  if (auth.status === "ACTIVE") return "AUTHORIZED";
  if (
    auth.status === "EXPIRED" ||
    auth.status === "REVOKED" ||
    auth.status === "ERROR"
  ) {
    return "EXPIRED";
  }
  if (
    nextAction.kind === "START_OAUTH" ||
    (checklist.azorIshiConfirmed &&
      checklist.taagidRegistered &&
      checklist.morsheAlAssigned &&
      checklist.osekMurshePresent)
  ) {
    return "READY_TO_AUTHORIZE";
  }
  return "GOV_SETUP_REQUIRED";
}

async function upsertReadinessRow(businessEntityId: string): Promise<{
  azorIshiConfirmed: boolean;
  taagidRegistered: boolean;
  morsheAlAssigned: boolean;
  osekMurshePresent: boolean;
  supportContactEmail: string | null;
  supportContactPhone: string | null;
  notes: string | null;
  lastConfirmedAt: Date | null;
}> {
  const [existing] = await db
    .select()
    .from(shaamTenantReadiness)
    .where(eq(shaamTenantReadiness.businessEntityId, businessEntityId))
    .limit(1);
  if (existing) {
    return {
      azorIshiConfirmed: existing.azorIshiConfirmed,
      taagidRegistered: existing.taagidRegistered,
      morsheAlAssigned: existing.morsheAlAssigned,
      osekMurshePresent: existing.osekMurshePresent,
      supportContactEmail: existing.supportContactEmail,
      supportContactPhone: existing.supportContactPhone,
      notes: existing.notes,
      lastConfirmedAt: existing.lastConfirmedAt,
    };
  }
  const [inserted] = await db
    .insert(shaamTenantReadiness)
    .values({ businessEntityId })
    .onConflictDoNothing()
    .returning();
  return {
    azorIshiConfirmed: inserted?.azorIshiConfirmed ?? false,
    taagidRegistered: inserted?.taagidRegistered ?? false,
    morsheAlAssigned: inserted?.morsheAlAssigned ?? false,
    osekMurshePresent: inserted?.osekMurshePresent ?? false,
    supportContactEmail: inserted?.supportContactEmail ?? null,
    supportContactPhone: inserted?.supportContactPhone ?? null,
    notes: inserted?.notes ?? null,
    lastConfirmedAt: inserted?.lastConfirmedAt ?? null,
  };
}

async function loadAuthorization(
  businessEntityId: string,
  environment: ShaamEnvironment,
): Promise<ReadinessSnapshot["authorization"]> {
  const [row] = await db
    .select({
      status: shaamAuthorizations.status,
      refreshTokenExpiresAt: shaamAuthorizations.refreshTokenExpiresAt,
    })
    .from(shaamAuthorizations)
    .where(
      and(
        eq(shaamAuthorizations.businessEntityId, businessEntityId),
        eq(shaamAuthorizations.environment, environment),
      ),
    )
    .limit(1);
  if (!row) {
    return { status: null, expiresAt: null, daysUntilExpiry: null };
  }
  const expiresAt = row.refreshTokenExpiresAt ?? null;
  const days =
    expiresAt === null
      ? null
      : Math.ceil(
          (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        );
  return {
    status: row.status,
    expiresAt,
    daysUntilExpiry: days,
  };
}

/**
 * Spec 09 — called by `business-entity-actions.ts` whenever the
 * osekMurshe is changed. Resets the self-report + derived flags and
 * revokes any active authorization (the ITA grant is tied to the
 * 9-digit number, so a change is effectively a new legal entity
 * context).
 */
export async function resetReadinessOnOsekMursheChange(params: {
  businessEntityId: string;
  actorUserId: string;
}): Promise<void> {
  await db
    .update(shaamTenantReadiness)
    .set({
      azorIshiConfirmed: false,
      taagidRegistered: false,
      morsheAlAssigned: false,
      osekMurshePresent: false,
      lastConfirmedAt: null,
      confirmedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(shaamTenantReadiness.businessEntityId, params.businessEntityId));

  const env = getShaamConfig().environment;
  const [auth] = await db
    .select({ status: shaamAuthorizations.status })
    .from(shaamAuthorizations)
    .where(
      and(
        eq(shaamAuthorizations.businessEntityId, params.businessEntityId),
        eq(shaamAuthorizations.environment, env),
      ),
    )
    .limit(1);
  if (auth && auth.status === "ACTIVE") {
    await revokeAuthorization({
      businessEntityId: params.businessEntityId,
      actorUserId: params.actorUserId,
      environment: env,
    });
  }
}

/**
 * Mark one of the three self-report checklist items + touch the
 * `last_confirmed_at` timestamp so the stuck-reminder cron can
 * detect stalled onboarding.
 */
export async function setReadinessStep(params: {
  businessEntityId: string;
  step: "azorIshi" | "taagid" | "morsheAl";
  confirmed: boolean;
  confirmedByUserId: string;
}): Promise<void> {
  const column =
    params.step === "azorIshi"
      ? "azor_ishi_confirmed"
      : params.step === "taagid"
        ? "taagid_registered"
        : "morshe_al_assigned";
  const now = new Date();
  // Upsert: ensure a row exists so the UPDATE has something to target.
  await db
    .insert(shaamTenantReadiness)
    .values({
      businessEntityId: params.businessEntityId,
      [params.step === "azorIshi"
        ? "azorIshiConfirmed"
        : params.step === "taagid"
          ? "taagidRegistered"
          : "morsheAlAssigned"]: params.confirmed,
      lastConfirmedAt: params.confirmed ? now : null,
      confirmedByUserId: params.confirmed ? params.confirmedByUserId : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: shaamTenantReadiness.businessEntityId,
      set: {
        [params.step === "azorIshi"
          ? "azorIshiConfirmed"
          : params.step === "taagid"
            ? "taagidRegistered"
            : "morsheAlAssigned"]: params.confirmed,
        lastConfirmedAt: params.confirmed
          ? now
          : sql`${shaamTenantReadiness.lastConfirmedAt}`,
        confirmedByUserId: params.confirmed
          ? params.confirmedByUserId
          : sql`${shaamTenantReadiness.confirmedByUserId}`,
        updatedAt: now,
      },
    });
  // Silence unused "column" var — it's the SQL column name held as
  // documentation for the Drizzle-columnKey mapping above.
  void column;
}

export async function setSupportContact(params: {
  businessEntityId: string;
  email?: string | null;
  phone?: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(shaamTenantReadiness)
    .values({
      businessEntityId: params.businessEntityId,
      supportContactEmail: params.email ?? null,
      supportContactPhone: params.phone ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: shaamTenantReadiness.businessEntityId,
      set: {
        supportContactEmail: params.email ?? null,
        supportContactPhone: params.phone ?? null,
        updatedAt: now,
      },
    });
}

export async function saveReadinessNotes(
  businessEntityId: string,
  notes: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(shaamTenantReadiness)
    .values({
      businessEntityId,
      notes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: shaamTenantReadiness.businessEntityId,
      set: { notes, updatedAt: now },
    });
}
