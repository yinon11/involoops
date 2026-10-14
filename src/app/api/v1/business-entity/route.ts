import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { serializeBusinessEntity } from "@/lib/api/serializers/business-entity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/business-entity
 *
 * The legal issuing entity tied to this user. v1 returns one entity
 * (multi-entity support will come with the multi-user RBAC rollout).
 *
 * Returns 404 if the user has not yet completed first-time business
 * details setup at /creator/business-details.
 */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["me:read"] }, async ({ ctx }) => {
    const entity = await getBusinessEntityForUserOrNull(ctx.user.id);
    if (!entity) throw apiErrors.notFound("Business entity");
    return { status: 200, body: serializeBusinessEntity(entity) };
  });
}
