import type { NextRequest } from "next/server";
import { ApiError, apiErrors, problemResponse } from "@/lib/api/errors";
import { deviceRefreshSchema } from "@/lib/api/schemas";
import { readOrCreateRequestId } from "@/lib/api/request-id";
import { revokeDeviceSessionByRefreshToken } from "@/lib/api/device-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/auth/logout — revoke the phone session. Unknown tokens still return 204. */
export async function POST(req: NextRequest) {
  const requestId = readOrCreateRequestId(req);
  try {
    let json: unknown = {};
    const text = await req.text();
    if (text.trim()) {
      try {
        json = JSON.parse(text);
      } catch {
        throw apiErrors.malformedJson();
      }
    }
    const parsed = deviceRefreshSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError({
        code: "validation_failed",
        status: 422,
        title: "refresh_token is required",
      });
    }
    await revokeDeviceSessionByRefreshToken(parsed.data.refresh_token);
    return new Response(null, {
      status: 204,
      headers: { "x-request-id": requestId },
    });
  } catch (err) {
    if (err instanceof ApiError) return problemResponse(err, requestId);
    console.error("[device-logout] unhandled", { requestId, err });
    return problemResponse(apiErrors.internal(), requestId);
  }
}
