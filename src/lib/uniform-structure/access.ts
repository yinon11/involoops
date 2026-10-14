import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { uniformStructureExports } from "@/db/schema";
import { isUserAdmin } from "@/lib/is-user-admin";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import { requirePermission } from "@/lib/rbac/authorize";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Studio users with `document:issue` (can issue invoices) and platform
 * admins (support / certification) may run exports and ITA printouts.
 */
export async function requireUniformStructureActor(): Promise<{
  userId: string;
  businessEntityId: string;
}> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  const entity = await getBusinessEntityForUser(userId);
  const admin = await isUserAdmin(userId);
  if (!admin) {
    await requirePermission({
      userId,
      businessEntityId: entity.id,
      permission: PERMISSIONS.DOCUMENT_ISSUE,
      route: "uniformStructure",
    });
  }

  return { userId, businessEntityId: entity.id };
}

export async function getUniformStructureExportForActor(runId: string): Promise<{
  userId: string;
  businessEntityId: string;
  exportRow: typeof uniformStructureExports.$inferSelect;
}> {
  const { userId, businessEntityId } = await requireUniformStructureActor();

  const [row] = await db
    .select()
    .from(uniformStructureExports)
    .where(eq(uniformStructureExports.runId, runId))
    .limit(1);

  if (!row) throw new Error("Export not found");
  if (row.businessEntityId !== businessEntityId) {
    throw new Error("Forbidden");
  }

  return { userId, businessEntityId, exportRow: row };
}
