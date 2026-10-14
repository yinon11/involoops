import type { NextRequest } from "next/server";
import { runApiRoute } from "@/lib/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/me
 *
 * Returns the authenticated identity, plus the calling key's metadata.
 * Useful for SDKs to confirm scopes and mode at startup.
 */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["me:read"] }, async ({ ctx }) => {
    return {
      status: 200,
      body: {
        object: "me",
        user: {
          object: "user",
          id: ctx.user.id,
          email: ctx.user.email,
          name: ctx.user.name,
        },
        api_key: {
          object: "api_key",
          id: ctx.apiKey.id,
          name: ctx.apiKey.name,
          mode: ctx.apiKey.mode,
          scopes: ctx.apiKey.scopes,
        },
      },
    };
  });
}
