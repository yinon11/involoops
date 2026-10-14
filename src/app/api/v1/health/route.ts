import { NextResponse, type NextRequest } from "next/server";
import { readOrCreateRequestId } from "@/lib/api/request-id";

/**
 * Public health check. No auth, no rate limiting — used by load balancer
 * probes. Deliberately cheap: does not touch the DB.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestId = readOrCreateRequestId(req);
  return NextResponse.json(
    { status: "ok", version: "1.0.0", request_id: requestId },
    {
      status: 200,
      headers: {
        "x-request-id": requestId,
        "cache-control": "no-store",
      },
    },
  );
}
