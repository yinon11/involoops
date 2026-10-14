/**
 * Canonical capability codes a sub-user can be granted while acting on
 * behalf of an account owner. Keep these stable — they are persisted on
 * `account_links.capabilities` and on pending `account_invitations.capabilities`.
 *
 * Read codes (`view_*`) imply only data visibility. Write codes (`manage_*`)
 * grant create/update/delete on that domain. Granting a `manage_` code
 * without the matching `view_` is allowed but pointless; the UI groups them.
 *
 * Pure constants only — this module is imported by client components, so it
 * MUST NOT pull in DB code. The server-side helpers (`resolveCapabilities`,
 * `listTeamMembers`) live in `./server.ts`.
 */
export const CAPABILITIES = [
  "view_invoices",
  "manage_invoices",
  "view_vendors",
  "manage_vendors",
  "view_customers",
  "manage_customers",
  "view_outbound",
  "manage_outbound",
  "view_reports",
  "manage_settings",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>(CAPABILITIES);

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

export function sanitizeCapabilities(input: unknown): Capability[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<Capability>();
  for (const v of input) {
    if (typeof v === "string" && isCapability(v)) out.add(v);
  }
  return [...out];
}

export interface ActorContext {
  /** The user id whose data is being read/written (the account "owner"). */
  ownerUserId: string;
  /** The signed-in user. Equal to ownerUserId when no switch is in effect. */
  actorUserId: string;
  /** Computed grants — empty when actor IS the owner means "all" (full access). */
  capabilities: Capability[];
  /** True when the actor IS the owner (full unrestricted access). */
  isOwner: boolean;
}

export function hasCapability(ctx: ActorContext, code: Capability): boolean {
  return ctx.isOwner || ctx.capabilities.includes(code);
}
