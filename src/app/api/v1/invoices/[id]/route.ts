import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import { expensePatchSchema } from "@/lib/api/schemas";
import { getExpenseForApi, patchExpenseForApi } from "@/lib/invoices/api-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return runApiRoute(req, { scopes: ["invoices:read"] }, async ({ ctx }) => {
    const row = await getExpenseForApi(ctx.user.id, id);
    if (!row) throw apiErrors.notFound("Invoice");
    return { status: 200, body: row };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["invoices:write"],
      body: expensePatchSchema,
      idempotency: "supported",
    },
    async ({ ctx, body }) => {
      const row = await patchExpenseForApi(ctx.user.id, id, body);
      if (!row) throw apiErrors.notFound("Invoice");
      return { status: 200, body: row };
    },
  );
}
