import type { NextRequest } from "next/server";
import { db } from "@/db";
import { invoiceTemplates } from "@/db/schema";
import { and, asc, eq, gt, or } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { buildPage, parsePaginationParams } from "@/lib/api/pagination";
import { serializeTemplate } from "@/lib/api/serializers/template";
import { templateUpsertSchema } from "@/lib/api/schemas";
import { mapTemplatePatch } from "@/lib/api/template-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/invoice-templates — cursor-paginated list, sorted by created_at ASC. */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["templates:read"] }, async ({ ctx, url }) => {
    const { limit, cursor } = parsePaginationParams(url);
    const filters = [eq(invoiceTemplates.userId, ctx.user.id)];
    if (cursor) {
      const cursorDate = new Date(cursor.k);
      if (!isNaN(cursorDate.getTime())) {
        filters.push(
          or(
            gt(invoiceTemplates.createdAt, cursorDate),
            and(
              eq(invoiceTemplates.createdAt, cursorDate),
              gt(invoiceTemplates.id, cursor.id),
            ),
          )!,
        );
      }
    }

    const rows = await db
      .select()
      .from(invoiceTemplates)
      .where(and(...filters))
      .orderBy(asc(invoiceTemplates.createdAt), asc(invoiceTemplates.id))
      .limit(limit + 1);

    return {
      status: 200,
      body: buildPage(
        rows.map(serializeTemplate),
        limit,
        (r) => r.created_at ?? "",
      ),
    };
  });
}

/** POST /api/v1/invoice-templates — create. Idempotency-Key required. */
export async function POST(req: NextRequest) {
  return runApiRoute(
    req,
    {
      scopes: ["templates:write"],
      body: templateUpsertSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      // If is_default is true (or unset → defaults to true), unset the
      // existing default so the unique invariant of "one default per user"
      // holds. Mirrors `upsertTemplate` in template-actions.ts.
      const wantsDefault = body.is_default !== false;
      if (wantsDefault) {
        await db
          .update(invoiceTemplates)
          .set({ isDefault: false })
          .where(eq(invoiceTemplates.userId, ctx.user.id));
      }

      const [row] = await db
        .insert(invoiceTemplates)
        .values({
          userId: ctx.user.id,
          name: body.name ?? "Default",
          ...mapTemplatePatch(body),
          isDefault: body.is_default ?? true,
        })
        .returning();

      return { status: 201, body: serializeTemplate(row) };
    },
  );
}

