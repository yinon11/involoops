import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { businessEntityMembers, rbacDenials } from "@/db/schema";
import { isUserAdmin } from "@/lib/is-user-admin";
import type { Permission } from "./permissions";

export type DenialReason =
  | "no_session"
  | "not_a_member"
  | "permission_not_granted"
  | "cross_tenant";

export type AuthorizeResult =
  | { allowed: true; reason?: undefined }
  | { allowed: false; reason: DenialReason };

export interface AuthorizeParams {
  userId: string;
  businessEntityId: string;
  permission: Permission;
  /** Optional — used only for the denial-log row. */
  route?: string;
}

/**
 * Core RBAC check. Always returns a shape; never throws.
 *
 * Evaluation order:
 *   1. Platform admin short-circuit — `isUserAdmin(userId)` is allowed
 *      unconditionally. This preserves today's "admins do everything"
 *      behaviour while the tenant UI doesn't exist yet. Admin usage does
 *      NOT write to `rbac_denials`.
 *   2. Membership lookup on `(businessEntityId, userId)`.
 *   3. Check the stored `permissions` JSON for the required permission
 *      string. Missing → `permission_not_granted`.
 *
 * Every denial appends a `rbac_denials` row so the ops team can spot
 * misconfigurations post-launch. The denial write is not in the audit
 * hash chain on purpose (it's high-cardinality and must not block).
 */
export async function authorize(
  params: AuthorizeParams,
): Promise<AuthorizeResult> {
  const { userId, businessEntityId, permission, route } = params;

  if (await isUserAdmin(userId)) {
    return { allowed: true };
  }

  const [member] = await db
    .select({
      permissions: businessEntityMembers.permissions,
    })
    .from(businessEntityMembers)
    .where(
      and(
        eq(businessEntityMembers.businessEntityId, businessEntityId),
        eq(businessEntityMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!member) {
    await logDenial({
      userId,
      businessEntityId,
      permission,
      reason: "not_a_member",
      route,
    });
    return { allowed: false, reason: "not_a_member" };
  }

  const granted = Array.isArray(member.permissions) ? member.permissions : [];
  if (!granted.includes(permission)) {
    await logDenial({
      userId,
      businessEntityId,
      permission,
      reason: "permission_not_granted",
      route,
    });
    return { allowed: false, reason: "permission_not_granted" };
  }

  return { allowed: true };
}

/**
 * Convenience wrapper: throws a generic 404-style error when denied so
 * cross-tenant probes cannot use error text to distinguish
 * "resource missing" from "not authorised".
 */
export async function requirePermission(
  params: AuthorizeParams,
): Promise<void> {
  const result = await authorize(params);
  if (!result.allowed) {
    throw new AuthorizationError(result.reason);
  }
}

export async function recordCrossTenantAttempt(params: {
  userId: string;
  businessEntityId: string | null;
  permission: Permission;
  route?: string;
}): Promise<void> {
  await logDenial({
    userId: params.userId,
    businessEntityId: params.businessEntityId,
    permission: params.permission,
    reason: "cross_tenant",
    route: params.route,
  });
}

async function logDenial(params: {
  userId: string;
  businessEntityId: string | null;
  permission: Permission;
  reason: DenialReason;
  route?: string;
}): Promise<void> {
  try {
    await db.insert(rbacDenials).values({
      userId: params.userId,
      businessEntityId: params.businessEntityId,
      permission: params.permission,
      reason: params.reason,
      route: params.route ?? null,
    });
  } catch (err) {
    // Denial logging must not mask the real authorization result.
    // Surface once to stderr and swallow.
    console.error("[rbac] failed to record denial:", err);
  }
}

export class AuthorizationError extends Error {
  readonly reason: DenialReason;
  constructor(reason: DenialReason) {
    super("Not found");
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}
