import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { purgeUserNow } from "@/actions/gdpr-actions";

/**
 * Constant-time compare against the configured CRON_SECRET. Returns false if
 * the secret isn't configured or the caller didn't send a Bearer token of the
 * same byte length (timingSafeEqual requires equal buffers).
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

/**
 * POST /api/cron/purge-scheduled-deletions
 *
 * Finds every user whose `deletion_scheduled_for` has elapsed and erases
 * them. Intended to be invoked by an external scheduler (Vercel Cron, GitHub
 * Actions, or any cron-as-a-service) once a day:
 *
 *   curl -X POST \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<host>/api/cron/purge-scheduled-deletions
 *
 * Processes at most 100 users per invocation so a backlog can't hold the
 * worker for unbounded time. If there's more than 100 due, run again.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary = {
    processed: 0,
    deletedUsers: 0,
    deletedFiles: 0,
    /**
     * Accounts whose identity was erased but whose documents are held back
     * because bookkeeping law still requires them. Their
     * `deletion_scheduled_for` has been moved to the end of the retention
     * window, so a later run finishes the job.
     */
    anonymisedPendingRetention: 0,
    errors: 0,
  };

  try {
    const due = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          isNotNull(users.deletionScheduledFor),
          lte(users.deletionScheduledFor, now)
        )
      )
      .limit(100);

    for (const { id } of due) {
      summary.processed++;
      try {
        const result = await purgeUserNow(id, now);
        if (result.deletedUserRow) summary.deletedUsers++;
        if (result.outcome === "anonymised_pending_retention") {
          summary.anonymisedPendingRetention++;
        }
        if (result.outcome === "failed") summary.errors++;
        summary.deletedFiles += result.deletedFiles;
      } catch (err) {
        console.error("[CronPurge] Failed to purge user", id, err);
        summary.errors++;
      }
    }

    return NextResponse.json(summary);
  } catch (err) {
    console.error("[CronPurge] Fatal error:", err);
    return NextResponse.json(
      { error: "Internal error", ...summary },
      { status: 500 }
    );
  }
}
