import type { NextRequest } from "next/server";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { buildPage, parsePaginationParams } from "@/lib/api/pagination";
import { serializeVendor } from "@/lib/api/serializers/vendor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/vendors — cursor-paginated list sorted by `name ASC, id ASC`.
 * Supports `q` substring match on name, `is_income_source` bool filter.
 */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["vendors:read"] }, async ({ ctx, url }) => {
    const { limit, cursor } = parsePaginationParams(url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const isIncomeSource = url.searchParams.get("is_income_source");

    const filters = [eq(vendors.userId, ctx.user.id)];
    if (q.length > 0) {
      filters.push(
        sql`lower(${vendors.name}) LIKE ${"%" + q.toLowerCase() + "%"}`,
      );
    }
    if (isIncomeSource === "true") {
      filters.push(eq(vendors.isIncomeSource, true));
    } else if (isIncomeSource === "false") {
      filters.push(eq(vendors.isIncomeSource, false));
    }
    if (cursor) {
      filters.push(
        or(
          gt(vendors.name, cursor.k),
          and(eq(vendors.name, cursor.k), gt(vendors.id, cursor.id)),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(vendors)
      .where(and(...filters))
      .orderBy(asc(vendors.name), asc(vendors.id))
      .limit(limit + 1);

    return {
      status: 200,
      body: buildPage(
        rows.map(serializeVendor),
        limit,
        (r) => r.name,
      ),
    };
  });
}
