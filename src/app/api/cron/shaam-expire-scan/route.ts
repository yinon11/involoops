import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { shaamAuthorizations, shaamTokenEvents } from "@/db/schema";
import {
  sendReadinessExpiredNotice,
  sendReadinessExpiryWarning,
} from "@/lib/shaam/notifications";

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

const WARNING_WINDOWS_DAYS = [14, 7, 1];

/**
 * Mark ACTIVE authorizations whose refresh token has already expired
 * as EXPIRED, log an AUTHORIZATION_EXPIRED token event, and send the
 * tenant the appropriate nudge email. Also sends proactive expiry
 * warnings at 14, 7, and 1 days before expiry. Designed for a daily
 * cadence; all sends are dedup'd via `notification_sent_log` so
 * repeat invocations on the same day are safe.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let expiredCount = 0;
  let warningsSent = 0;

  // --- 1) terminal expiry reconciliation + expired-notice email ---
  const expiredRows = await db
    .select({
      id: shaamAuthorizations.id,
      businessEntityId: shaamAuthorizations.businessEntityId,
      environment: shaamAuthorizations.environment,
    })
    .from(shaamAuthorizations)
    .where(
      and(
        eq(shaamAuthorizations.status, "ACTIVE"),
        lt(shaamAuthorizations.refreshTokenExpiresAt, now),
      ),
    );

  for (const row of expiredRows) {
    await db.transaction(async (tx) => {
      await tx
        .update(shaamAuthorizations)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(eq(shaamAuthorizations.id, row.id));
      await tx.insert(shaamTokenEvents).values({
        businessEntityId: row.businessEntityId,
        environment: row.environment,
        eventType: "AUTHORIZATION_EXPIRED",
        errorCode: "refresh_token_past_ttl",
        errorMessage: "Refresh token TTL elapsed before rotation",
      });
    });
    try {
      await sendReadinessExpiredNotice(row.businessEntityId);
    } catch (err) {
      console.error(
        `[shaam-expire-scan] expired-notice failed for ${row.businessEntityId}:`,
        err,
      );
    }
    expiredCount += 1;
  }

  // --- 2) proactive warnings at 14d / 7d / 1d ---
  for (const daysAhead of WARNING_WINDOWS_DAYS) {
    const windowStart = new Date(now.getTime() + daysAhead * 86_400_000);
    const windowEnd = new Date(windowStart.getTime() + 86_400_000);
    const rows = await db
      .select({
        businessEntityId: shaamAuthorizations.businessEntityId,
      })
      .from(shaamAuthorizations)
      .where(
        and(
          eq(shaamAuthorizations.status, "ACTIVE"),
          gte(shaamAuthorizations.refreshTokenExpiresAt, windowStart),
          lte(shaamAuthorizations.refreshTokenExpiresAt, windowEnd),
        ),
      );
    for (const row of rows) {
      try {
        await sendReadinessExpiryWarning(row.businessEntityId, daysAhead);
        warningsSent += 1;
      } catch (err) {
        console.error(
          `[shaam-expire-scan] warning-${daysAhead}d failed for ${row.businessEntityId}:`,
          err,
        );
      }
    }
  }

  return NextResponse.json({
    expiredCount,
    warningsSent,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
