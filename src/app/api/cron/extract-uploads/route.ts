import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runUploadJobBatch } from "@/lib/uploads/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/extract-uploads
 *
 * Claims queued upload jobs, runs the extraction pipeline, emits
 * invoice.processed / invoice.processing_failed webhooks. Same Bearer
 * CRON_SECRET pattern as the other cron routes. Safe under concurrent
 * invocation (SKIP LOCKED on the claim query).
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
    Number.isFinite(rawBatch) && rawBatch > 0 && rawBatch <= 100
      ? Math.floor(rawBatch)
      : 10;
  const summary = await runUploadJobBatch(batchSize);
  return NextResponse.json({ ok: true, ...summary });
}

export const POST = handle;
export const GET = handle;
