import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { dashboardForUser } from "@/lib/dashboard/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/dashboard — this month's income, expenses, and what needs a decision. */
export async function GET(req: NextRequest) {
  return runApiRoute(
    req,
    { scopes: ["invoices:read", "outbound:read"] },
    async ({ ctx }) => {
      const body = await dashboardForUser(ctx.user.id);
      return { status: 200, body };
    },
  );
}
