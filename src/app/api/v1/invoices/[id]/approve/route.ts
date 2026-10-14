import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import { expenseApproveSchema } from "@/lib/api/schemas";
import { approveExpenseForApi } from "@/lib/invoices/api-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["invoices:write"],
      body: expenseApproveSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const row = await approveExpenseForApi(ctx.user.id, id, body.vendor_name);
      if (!row) throw apiErrors.notFound("Invoice");
      return { status: 200, body: row };
    },
  );
}
