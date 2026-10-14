import type { NextRequest } from "next/server";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { serializeCustomer } from "@/lib/api/serializers/customer";
import { customerUpdateSchema } from "@/lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/customers/{id} */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(req, { scopes: ["customers:read"] }, async ({ ctx }) => {
    const rows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.userId, ctx.user.id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw apiErrors.notFound("Customer");
    return { status: 200, body: serializeCustomer(row) };
  });
}

/** PATCH /api/v1/customers/{id} — partial update. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["customers:write"],
      body: customerUpdateSchema,
      idempotency: "supported",
    },
    async ({ ctx, body }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.email !== undefined) patch.email = body.email;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.address !== undefined) patch.address = body.address;
      if (body.tax_id !== undefined) patch.taxId = body.tax_id;
      if (body.notes !== undefined) patch.notes = body.notes;

      try {
        const [row] = await db
          .update(customers)
          .set(patch)
          .where(and(eq(customers.id, id), eq(customers.userId, ctx.user.id)))
          .returning();
        if (!row) throw apiErrors.notFound("Customer");
        return { status: 200, body: serializeCustomer(row) };
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: string }).code === "23505"
        ) {
          throw new ApiError({
            code: "conflict",
            status: 409,
            title: "Another customer with this name already exists",
          });
        }
        throw err;
      }
    },
  );
}

/** DELETE /api/v1/customers/{id} — hard delete. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    { scopes: ["customers:write"], idempotency: "supported" },
    async ({ ctx }) => {
      const rows = await db
        .delete(customers)
        .where(and(eq(customers.id, id), eq(customers.userId, ctx.user.id)))
        .returning({ id: customers.id });
      if (rows.length === 0) throw apiErrors.notFound("Customer");
      return { status: 204, body: null };
    },
  );
}
