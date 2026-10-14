import type { NextRequest } from "next/server";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { buildPage, parsePaginationParams } from "@/lib/api/pagination";
import { serializeCustomer } from "@/lib/api/serializers/customer";
import { customerCreateSchema } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/customers — cursor-paginated list, optional `q` substring. */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["customers:read"] }, async ({ ctx, url }) => {
    const { limit, cursor } = parsePaginationParams(url);
    const q = url.searchParams.get("q")?.trim() ?? "";

    const filters = [eq(customers.userId, ctx.user.id)];
    if (q.length > 0) {
      filters.push(
        sql`lower(${customers.name}) LIKE ${"%" + q.toLowerCase() + "%"}`,
      );
    }
    if (cursor) {
      const cursorDate = new Date(cursor.k);
      if (!isNaN(cursorDate.getTime())) {
        filters.push(
          or(
            lt(customers.createdAt, cursorDate),
            and(
              eq(customers.createdAt, cursorDate),
              lt(customers.id, cursor.id),
            ),
          )!,
        );
      }
    }

    const rows = await db
      .select()
      .from(customers)
      .where(and(...filters))
      .orderBy(desc(customers.createdAt), desc(customers.id))
      .limit(limit + 1);

    return {
      status: 200,
      body: buildPage(
        rows.map(serializeCustomer),
        limit,
        (r) => r.created_at ?? "",
      ),
    };
  });
}

/** POST /api/v1/customers — create. Idempotency-Key required. */
export async function POST(req: NextRequest) {
  return runApiRoute(
    req,
    {
      scopes: ["customers:write"],
      body: customerCreateSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      try {
        const [row] = await db
          .insert(customers)
          .values({
            userId: ctx.user.id,
            name: body.name,
            email: body.email ?? null,
            phone: body.phone ?? null,
            address: body.address ?? null,
            taxId: body.tax_id ?? null,
            notes: body.notes ?? null,
          })
          .returning();
        return { status: 201, body: serializeCustomer(row) };
      } catch (err) {
        // Unique (user_id, name) conflict → 409.
        if (isUniqueViolation(err)) {
          throw new ApiError({
            code: "conflict",
            status: 409,
            title: "Customer with this name already exists",
          });
        }
        throw err;
      }
    },
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}
