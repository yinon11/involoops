import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runWebhookDeliveryBatch } from "@/lib/webhooks/deliver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/webhook-deliveries
 *
 * Drains pending webhook deliveries. Called by the host cron every minute
 * (or on-demand by the admin UI for draining). Claims up to 25 rows per
 * invocation via `FOR UPDATE SKIP LOCKED` so multiple concurrent runs are
 * safe.
 *
 * Auth: Bearer CRON_SECRET (constant-time compared). Matches the pattern
 * used by the other /api/cron/* routes.
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
  const rawBatch = Number(url.searchParams.get("batch"));
  const batchSize =
    Number.isFinite(rawBatch) && rawBatch > 0 && rawBatch <= 200
      ? Math.floor(rawBatch)
      : 25;

  const summary = await runWebhookDeliveryBatch(batchSize);
  return NextResponse.json({ ok: true, ...summary });
}

export const POST = handle;
export const GET = handle;
