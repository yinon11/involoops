import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outboundInvoices } from "@/db/schema";
import { requireActorUserId } from "@/lib/team/enforce";
import { callerFromUserId } from "@/lib/outbound/operations";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Per-document remediation is the seller's own work, not a support task,
 * so it runs on the normal RBAC permission rather than the platform admin
 * flag. Resolving a refusal on your own invoice should not require us.
 *
 * Because this widens who can call these actions, it also has to do the
 * tenant scoping the admin gate used to make redundant: the document must
 * belong to the caller's business entity.
 *
 * Lives outside the `"use server"` action files on purpose: exported from
 * one of those it would itself become a callable endpoint.
 */
export async function requireDocumentActor(
  documentId: string,
  route: string,
): Promise<{
  userId: string;
  businessEntityId: string;
}> {
  const userId = await requireActorUserId("manage_outbound");
  const caller = await callerFromUserId(userId);
  await requirePermission({
    userId: caller.userId,
    businessEntityId: caller.businessEntityId,
    permission: PERMISSIONS.DOCUMENT_ISSUE,
    route,
  });

  const [row] = await db
    .select({ businessEntityId: outboundInvoices.businessEntityId })
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, documentId))
    .limit(1);
  if (!row || row.businessEntityId !== caller.businessEntityId) {
    // Same message either way — an attacker should not be able to probe
    // which document ids exist in other tenants.
    throw new Error("Invoice not found");
  }
  return caller;
}
