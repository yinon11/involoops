import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ApiError, apiErrors, problemResponse } from "@/lib/api/errors";
import { deviceRefreshSchema } from "@/lib/api/schemas";
import { readOrCreateRequestId } from "@/lib/api/request-id";
import { clientIpFromRequest } from "@/lib/rate-limit";
import { rotateDeviceSession } from "@/lib/api/device-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/auth/refresh — rotate the refresh token and mint a new access token. */
export async function POST(req: NextRequest) {
  const requestId = readOrCreateRequestId(req);
  try {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw apiErrors.malformedJson();
    }
    const parsed = deviceRefreshSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError({
        code: "validation_failed",
        status: 422,
        title: "Validation failed",
      });
    }
    const tokens = await rotateDeviceSession({
      refreshToken: parsed.data.refresh_token,
      ip: clientIpFromRequest(req),
    });
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        preferredLocale: users.preferredLocale,
      })
      .from(users)
      .where(eq(users.id, tokens.userId))
      .limit(1);

    return Response.json(
      {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        user: user
          ? {
              id: user.id,
              email: user.email,
              name: user.name,
              locale: user.preferredLocale === "he" ? "he" : "en",
            }
          : null,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (err) {
    if (err instanceof ApiError) return problemResponse(err, requestId);
    console.error("[device-refresh] unhandled", { requestId, err });
    return problemResponse(apiErrors.internal(), requestId);
  }
}
