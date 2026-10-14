import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { archiveObjects } from "@/db/schema";
import { getArchiveObjectRetention } from "@/lib/archive/s3";

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

/** Minimum retention in days we require on every archive object. */
const MIN_RETENTION_DAYS = 2550;

/**
 * Sample ~1% of archive objects (at least 10) and verify that each
 * one still carries COMPLIANCE-mode Object Lock with a RetainUntil
 * at least MIN_RETENTION_DAYS from `storedAt`. Designed for weekly
 * invocation; catches bucket-policy drift before it becomes a
 * regulatory problem.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(archiveObjects);
  const total = Number(countRow?.total ?? 0);
  const sampleSize = Math.max(10, Math.floor(total * 0.01));

  const rows = await db
    .select()
    .from(archiveObjects)
    .orderBy(sql`random()`, desc(archiveObjects.storedAt))
    .limit(sampleSize);

  const problems: Array<{
    archiveObjectId: string;
    observedMode: string | null;
    observedUntil: string | null;
    expectedUntil: string;
  }> = [];

  for (const row of rows) {
    try {
      const retention = await getArchiveObjectRetention({
        key: row.s3Key,
        versionId: row.s3VersionId,
      });
      const minUntil = new Date(
        row.storedAt.getTime() + MIN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const ok =
        retention.mode === "COMPLIANCE" &&
        retention.retainUntil !== null &&
        retention.retainUntil.getTime() >= minUntil.getTime();
      if (!ok) {
        problems.push({
          archiveObjectId: row.id,
          observedMode: retention.mode ?? null,
          observedUntil: retention.retainUntil?.toISOString() ?? null,
          expectedUntil: minUntil.toISOString(),
        });
        console.error(
          `[archive-locks] object=${row.id} mode=${retention.mode} until=${retention.retainUntil?.toISOString()} expected>=${minUntil.toISOString()}`,
        );
      }
    } catch (err) {
      problems.push({
        archiveObjectId: row.id,
        observedMode: null,
        observedUntil: null,
        expectedUntil: "error",
      });
      console.error(
        `[archive-locks] object=${row.id} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return NextResponse.json({
    total,
    sampled: rows.length,
    problems,
    anyProblem: problems.length > 0,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
