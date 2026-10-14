import "server-only";
import { auth } from "@/auth";
import type { Capability } from "./capabilities";

/**
 * Whether the UI should expose `/settings` and creator sidebar entries under
 * `/settings/*` (ITA integration, API keys).
 *
 * - `null` / undefined capabilities → owner login or admin impersonation → allowed.
 * - Array → team member acting-as → need explicit `manage_settings`.
 * - Malformed `[]` with no `originator` is treated like full access (see
 *   {@link getActingCapabilities}).
 */
export function canAccessSettingsUi(
  actingAsCapabilities: string[] | null | undefined,
  originator?: { id: string } | null,
): boolean {
  if (actingAsCapabilities == null) return true;
  if (originator == null && actingAsCapabilities.length === 0) return true;
  return actingAsCapabilities.includes("manage_settings");
}

/**
 * Read the capability set the current session holds.
 *
 * - `null` means the user is on their own account (or is an admin
 *   impersonating someone) — full access, capability gates do not apply.
 * - An array (possibly empty) means the user is acting-as someone via an
 *   account_links row; the array is the exact granted set.
 *
 * The intent is "see nothing, do nothing" for an empty array, so callers
 * MUST treat unknown capabilities as denied.
 */
export async function getActingCapabilities(): Promise<Capability[] | null> {
  const session = await auth();
  // Platform admins are never restricted by team capability gates — they
  // implicitly hold every cap. This also rescues admins whose JWT carries a
  // stale `actingAsCapabilities: []` from a previous switch-account flow.
  if (session?.user?.isAdmin) return null;
  const originatorId = session?.user?.originator?.id;
  if (originatorId) {
    const { isUserAdmin } = await import("@/lib/is-user-admin");
    if (await isUserAdmin(originatorId)) return null;
  }
  const value = session?.user?.actingAsCapabilities;
  if (value === null || value === undefined) return null;
  const actingAsAnotherAccount = session?.user?.originator != null;
  // Only switched / team sessions use a non-null capability array. On the
  // owner's own account the JWT should carry `null`; an empty array is a
  // malformed / legacy token state and would make every `hasCap` check fail
  // (404 on dashboard, income, profit, …).
  if (!actingAsAnotherAccount && value.length === 0) {
    return null;
  }
  return value as Capability[];
}

/**
 * Check whether the current session holds a capability.
 *
 * Returns `true` for owners and admin-impersonators (no restriction
 * applies); returns `true` for sub-users only when the code is present in
 * the granted set.
 */
export async function hasCap(code: Capability): Promise<boolean> {
  const caps = await getActingCapabilities();
  if (caps === null) return true;
  return caps.includes(code);
}

/**
 * Resolve the signed-in data user id for server actions, optionally enforcing
 * a team capability. Uses {@link hasCap} so owner sessions with a malformed
 * empty `actingAsCapabilities` array (see {@link getActingCapabilities}) are
 * not accidentally denied.
 */
export async function requireActorUserId(cap?: Capability): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  if (cap !== undefined && !(await hasCap(cap))) {
    throw new Error("Permission denied");
  }
  return session.user.id;
}

const PERMISSION_DENIED = "You don't have permission to do this.";

/**
 * Action-shaped capability gate. Returns `null` when allowed, or a
 * `{ ok: false, error }` payload that callers can return directly.
 *
 * Usage:
 *   const denied = await requireCap("manage_invoices");
 *   if (denied) return denied;
 */
export async function requireCap(
  code: Capability,
): Promise<{ ok: false; error: string } | null> {
  const allowed = await hasCap(code);
  return allowed ? null : { ok: false, error: PERMISSION_DENIED };
}

/**
 * Variant for actions that historically return `{ error }` (no `ok`
 * field), e.g. action-helpers used by the older expense feature.
 */
export async function requireCapLegacy(
  code: Capability,
): Promise<{ error: string } | null> {
  const allowed = await hasCap(code);
  return allowed ? null : { error: PERMISSION_DENIED };
}

/**
 * Variant for actions that use `{ success: false, error }` for
 * validation errors (`ActionResult` shape in expenses feature).
 */
export async function requireCapAction(
  code: Capability,
): Promise<{ success: false; error: string } | null> {
  const allowed = await hasCap(code);
  return allowed ? null : { success: false, error: PERMISSION_DENIED };
}

/**
 * Throwing variant for read paths where a structured return isn't
 * convenient (server components, query builders).
 */
export async function assertCap(code: Capability): Promise<void> {
  if (!(await hasCap(code))) {
    throw new Error(PERMISSION_DENIED);
  }
}

/**
 * Page-level gate. Use at the top of a server-component page to render
 * a 404 when the actor lacks the required capability — matches the
 * existing admin-page pattern (`notFound()` if not admin).
 */
export async function ensureCapOrNotFound(code: Capability): Promise<void> {
  const { notFound } = await import("next/navigation");
  if (!(await hasCap(code))) {
    notFound();
  }
}
