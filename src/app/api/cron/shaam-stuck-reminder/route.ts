import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { shaamTenantReadiness, shaamAuthorizations } from "@/db/schema";
import { sendReadinessStuckReminder } from "@/lib/shaam/notifications";

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

/**
 * Spec 09 — weekly "you're almost done!" nudge for tenants who've
 * confirmed at least one checklist step but haven't completed the
 * OAuth flow within 7 days. Dedup inside
 * `sendReadinessStuckReminder` means a re-run in the same ISO week
 * is safe.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const candidates = await db
    .select({
      businessEntityId: shaamTenantReadiness.businessEntityId,
    })
    .from(shaamTenantReadiness)
    .leftJoin(
      shaamAuthorizations,
      eq(
        shaamAuthorizations.businessEntityId,
        shaamTenantReadiness.businessEntityId,
      ),
    )
    .where(
      and(
        lt(shaamTenantReadiness.lastConfirmedAt, cutoff),
        or(
          eq(shaamAuthorizations.status, "PENDING"),
          eq(shaamAuthorizations.status, "EXPIRED"),
          eq(shaamAuthorizations.status, "REVOKED"),
          eq(shaamAuthorizations.status, "ERROR"),
        ),
      ),
    );

  const uniqueEntityIds = Array.from(
    new Set(candidates.map((r) => r.businessEntityId)),
  );

  let sent = 0;
  for (const id of uniqueEntityIds) {
    try {
      await sendReadinessStuckReminder(id);
      sent += 1;
    } catch (err) {
      console.error(
        `[shaam-stuck-reminder] failed for ${id}:`,
        err,
      );
    }
  }

  return NextResponse.json({
    candidates: uniqueEntityIds.length,
    sent,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
