import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { buildPage, parsePaginationParams } from "@/lib/api/pagination";
import {
  listExpensesForApi,
  parseInvoiceStatus,
} from "@/lib/invoices/api-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/invoices — cursor list. `status=pending` is the phone review queue. */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["invoices:read"] }, async ({ ctx, url }) => {
    const rawStatus = url.searchParams.get("status");
    const status = parseInvoiceStatus(rawStatus);
    if (rawStatus && !status) {
      throw new ApiError({
        code: "validation_failed",
        status: 422,
        title: "Unknown status",
        detail: "status must be processing, pending, approved, or rejected.",
      });
    }
    const { limit, cursor } = parsePaginationParams(url);
    const rows = await listExpensesForApi({
      userId: ctx.user.id,
      status,
      limit,
      cursor,
    });
    return {
      status: 200,
      body: buildPage(rows, limit, (row) => row.created_at),
    };
  });
}
