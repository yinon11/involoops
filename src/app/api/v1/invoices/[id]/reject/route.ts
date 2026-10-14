import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import { expenseRejectSchema } from "@/lib/api/schemas";
import { rejectExpenseForApi } from "@/lib/invoices/api-ops";

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
      body: expenseRejectSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      const row = await rejectExpenseForApi(ctx.user.id, id, body.reason);
      if (!row) throw apiErrors.notFound("Invoice");
      return { status: 200, body: row };
    },
  );
}
