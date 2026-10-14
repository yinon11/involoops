import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ApiError, apiErrors, problemResponse } from "@/lib/api/errors";
import { deviceLoginSchema } from "@/lib/api/schemas";
import { readOrCreateRequestId } from "@/lib/api/request-id";
import { clientIpFromRequest, enforceRateLimit } from "@/lib/rate-limit";
import {
  findUserByEmail,
  issueDeviceSession,
} from "@/lib/api/device-session";
import { verifyMfaInput } from "@/actions/mfa-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/login
 *
 * Email and password for the phone app. When the account has MFA and no
 * code was sent, the response is `{ mfa_required: true }` and no token.
 * A correct password plus a valid code (or an account without MFA) returns
 * an access token and a refresh token.
 */
export async function POST(req: NextRequest) {
  const requestId = readOrCreateRequestId(req);
  try {
    const ip = clientIpFromRequest(req);
    const ipLimit = await enforceRateLimit(`login:ip:${ip}`, 20, 5 * 60);
    if (!ipLimit.ok) {
      throw apiErrors.rateLimited(ipLimit.retryAfter, "Too many login attempts.");
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw apiErrors.malformedJson();
    }
    const parsed = deviceLoginSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError({
        code: "validation_failed",
        status: 422,
        title: "Validation failed",
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const emailLimit = await enforceRateLimit(`login:email:${email}`, 10, 15 * 60);
    if (!emailLimit.ok) {
      throw apiErrors.rateLimited(
        emailLimit.retryAfter,
        "Too many login attempts for this account.",
      );
    }

    const user = await findUserByEmail(email);
    if (!user?.passwordHash) {
      throw new ApiError({
        code: "invalid_key",
        status: 401,
        title: "Invalid email or password",
      });
    }
    const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!passwordOk) {
      throw new ApiError({
        code: "invalid_key",
        status: 401,
        title: "Invalid email or password",
      });
    }

    const mfaCode = parsed.data.mfa_code?.trim() ?? "";
    if (user.mfaEnabled && !mfaCode) {
      return Response.json({ mfa_required: true }, { headers: { "x-request-id": requestId } });
    }
    if (user.mfaEnabled) {
      const result = await verifyMfaInput({
        input: mfaCode,
        ciphertext: user.mfaSecretCiphertext,
        iv: user.mfaSecretIv,
        tag: user.mfaSecretTag,
        backupHashes: user.mfaBackupCodes ?? [],
      });
      if (!result.valid) {
        throw new ApiError({
          code: "invalid_key",
          status: 401,
          title: "Invalid verification code",
        });
      }
      if (result.updatedBackupHashes) {
        await db
          .update(users)
          .set({ mfaBackupCodes: result.updatedBackupHashes })
          .where(eq(users.id, user.id));
      }
    }

    const tokens = await issueDeviceSession({
      userId: user.id,
      deviceName: parsed.data.device_name?.trim() || "Mobile",
      ip,
    });

    return Response.json(
      {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          locale: user.preferredLocale === "he" ? "he" : "en",
        },
      },
      { status: 200, headers: { "x-request-id": requestId } },
    );
  } catch (err) {
    if (err instanceof ApiError) return problemResponse(err, requestId);
    console.error("[device-login] unhandled", { requestId, err });
    return problemResponse(apiErrors.internal(), requestId);
  }
}
