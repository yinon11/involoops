import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountLinks, users } from "@/db/schema";
import {
  CAPABILITIES,
  sanitizeCapabilities,
  type ActorContext,
} from "./capabilities";

/**
 * Resolve the capability grants the `actorUserId` has against `ownerUserId`.
 * - If they are the same user, this is the owner: full access (`isOwner: true`).
 * - Otherwise we look up the directed `account_links` row and read its
 *   `capabilities`. Missing link → no access (empty array, not owner).
 */
export async function resolveCapabilities(params: {
  actorUserId: string;
  ownerUserId: string;
}): Promise<ActorContext> {
  const { actorUserId, ownerUserId } = params;
  if (actorUserId === ownerUserId) {
    return {
      actorUserId,
      ownerUserId,
      capabilities: [...CAPABILITIES],
      isOwner: true,
    };
  }
  const link = await db.query.accountLinks.findFirst({
    where: and(
      eq(accountLinks.managerUserId, actorUserId),
      eq(accountLinks.managedUserId, ownerUserId),
    ),
    columns: { capabilities: true },
  });
  return {
    actorUserId,
    ownerUserId,
    capabilities: sanitizeCapabilities(link?.capabilities ?? []),
    isOwner: false,
  };
}

/**
 * List the team members linked to an owner account, with their granted
 * capabilities. Used by the owner-facing settings UI.
 */
export async function listTeamMembers(ownerUserId: string) {
  return db
    .select({
      linkId: accountLinks.id,
      memberUserId: users.id,
      memberEmail: users.email,
      memberName: users.name,
      capabilities: accountLinks.capabilities,
      autoActAs: accountLinks.autoActAs,
      createdAt: accountLinks.createdAt,
    })
    .from(accountLinks)
    .innerJoin(users, eq(accountLinks.managerUserId, users.id))
    .where(eq(accountLinks.managedUserId, ownerUserId));
}
