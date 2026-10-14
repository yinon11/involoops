import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { apiIdempotencyKeys } from "@/db/schema";
import { lt } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/cleanup-idempotency-keys
 *
 * Evicts `api_idempotency_keys` rows older than 24h (matches the replay
 * window enforced in src/lib/api/idempotency.ts). Run daily from host
 * cron. Same Bearer CRON_SECRET pattern as the other crons.
 */
function verifyCronSecret(authHeader: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const provided = authHeader.slice("Bearer ".length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawHours = Number(url.searchParams.get("olderThanHours"));
  const hours =
    Number.isFinite(rawHours) && rawHours > 0 ? Math.floor(rawHours) : 24;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const result = await db
    .delete(apiIdempotencyKeys)
    .where(lt(apiIdempotencyKeys.createdAt, cutoff))
    .returning({ key: apiIdempotencyKeys.key });

  return NextResponse.json({
    ok: true,
    deleted: result.length,
    cutoff: cutoff.toISOString(),
  });
}

export const POST = handle;
export const GET = handle;
