import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { listDuplicateGroups } from "@/lib/invoices/duplicate-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/duplicates — expense groups that look like the same document. */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["invoices:read"] }, async ({ ctx }) => {
    const data = await listDuplicateGroups(ctx.user.id);
    return { status: 200, body: { data } };
  });
}
