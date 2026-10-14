import type { NextRequest } from "next/server";
import { db } from "@/db";
import { invoiceTemplates } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import { serializeTemplate } from "@/lib/api/serializers/template";
import { templateUpsertSchema } from "@/lib/api/schemas";
import { mapTemplatePatch } from "@/lib/api/template-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(req, { scopes: ["templates:read"] }, async ({ ctx }) => {
    const rows = await db
      .select()
      .from(invoiceTemplates)
      .where(
        and(eq(invoiceTemplates.id, id), eq(invoiceTemplates.userId, ctx.user.id)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw apiErrors.notFound("Template");
    return { status: 200, body: serializeTemplate(row) };
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["templates:write"],
      body: templateUpsertSchema,
      idempotency: "supported",
    },
    async ({ ctx, body }) => {
      // Promoting to default → demote any other default for this user.
      if (body.is_default === true) {
        await db
          .update(invoiceTemplates)
          .set({ isDefault: false })
          .where(
            and(
              eq(invoiceTemplates.userId, ctx.user.id),
              ne(invoiceTemplates.id, id),
            ),
          );
      }

      const patch: Record<string, unknown> = {
        ...mapTemplatePatch(body),
        updatedAt: new Date(),
      };
      if (body.name !== undefined) patch.name = body.name;
      if (body.is_default !== undefined) patch.isDefault = body.is_default;

      const [row] = await db
        .update(invoiceTemplates)
        .set(patch)
        .where(
          and(
            eq(invoiceTemplates.id, id),
            eq(invoiceTemplates.userId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) throw apiErrors.notFound("Template");
      return { status: 200, body: serializeTemplate(row) };
    },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    { scopes: ["templates:write"], idempotency: "supported" },
    async ({ ctx }) => {
      const rows = await db
        .delete(invoiceTemplates)
        .where(
          and(
            eq(invoiceTemplates.id, id),
            eq(invoiceTemplates.userId, ctx.user.id),
          ),
        )
        .returning({ id: invoiceTemplates.id });
      if (rows.length === 0) throw apiErrors.notFound("Template");
      return { status: 204, body: null };
    },
  );
}
