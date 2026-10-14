import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { shaamAuthorizations } from "@/db/schema";
import { getActiveAccessToken } from "@/lib/shaam/authorization";

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

const ACCESS_REFRESH_WINDOW_MS = 30 * 60 * 1000;
const REFRESH_ROTATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Proactively refresh SHAAM access tokens that are close to expiry
 * and rotate refresh tokens that are within the 7-day rotation
 * window. Designed for a ~6-hour cadence — refresh tokens last 90
 * days so any schedule finer than weekly is over-conservative, but
 * the access-token leg is the one that actually prevents user-facing
 * 401s during a business's work day.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const accessCutoff = new Date(now.getTime() + ACCESS_REFRESH_WINDOW_MS);
  const refreshCutoff = new Date(now.getTime() + REFRESH_ROTATE_WINDOW_MS);

  const rows = await db
    .select({
      businessEntityId: shaamAuthorizations.businessEntityId,
      environment: shaamAuthorizations.environment,
      accessTokenExpiresAt: shaamAuthorizations.accessTokenExpiresAt,
      refreshTokenExpiresAt: shaamAuthorizations.refreshTokenExpiresAt,
    })
    .from(shaamAuthorizations)
    .where(
      and(
        eq(shaamAuthorizations.status, "ACTIVE"),
        or(
          lt(shaamAuthorizations.accessTokenExpiresAt, accessCutoff),
          lt(shaamAuthorizations.refreshTokenExpiresAt, refreshCutoff),
        ),
      ),
    );

  const failed: Array<{ businessEntityId: string; error: string }> = [];
  let refreshedAccess = 0;
  let rotatedRefresh = 0;

  for (const row of rows) {
    try {
      const before = row.refreshTokenExpiresAt?.getTime() ?? 0;
      await getActiveAccessToken({
        businessEntityId: row.businessEntityId,
        environment: row.environment,
      });
      const [fresh] = await db
        .select({
          refreshTokenExpiresAt: shaamAuthorizations.refreshTokenExpiresAt,
        })
        .from(shaamAuthorizations)
        .where(
          and(
            eq(shaamAuthorizations.businessEntityId, row.businessEntityId),
            eq(shaamAuthorizations.environment, row.environment),
          ),
        )
        .limit(1);
      refreshedAccess += 1;
      const after = fresh?.refreshTokenExpiresAt?.getTime() ?? 0;
      if (after > before) rotatedRefresh += 1;
    } catch (err) {
      failed.push({
        businessEntityId: row.businessEntityId,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(
        `[shaam-refresh] business_entity_id=${row.businessEntityId} env=${row.environment} error=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return NextResponse.json({
    scanned: rows.length,
    refreshedAccess,
    rotatedRefresh,
    failed,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
