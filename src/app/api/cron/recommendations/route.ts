/**
 * POST /api/cron/recommendations
 *
 * Generates AI recommendations for all active users who have at least one
 * outbound invoice. Secured with CRON_SECRET bearer token.
 *
 * Run daily (or on whatever schedule the host cron is configured for).
 * Processes max 50 users per run to stay within serverless timeouts.
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { outboundInvoices, users } from "@/db/schema";
import { businessEntities } from "@/db/schema/business-entities";
import { eq, sql } from "drizzle-orm";
import { generateRecommendations } from "@/features/generator/lib/recommendation-engine";

const MAX_USERS_PER_RUN = 50;

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

export async function POST(request: Request) {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = { processed: 0, succeeded: 0, failed: 0 };

  try {
    // Find active users who have at least one outbound invoice (not just
    // signed up but haven't used the generator yet).
    const activeUserRows = await db
      .selectDistinct({ userId: businessEntities.ownerUserId })
      .from(businessEntities)
      .innerJoin(
        outboundInvoices,
        eq(outboundInvoices.businessEntityId, businessEntities.id),
      )
      .where(sql`${outboundInvoices.deletedAt} IS NULL`)
      .limit(MAX_USERS_PER_RUN);

    for (const row of activeUserRows) {
      summary.processed++;
      try {
        await generateRecommendations(row.userId);
        summary.succeeded++;
      } catch (err) {
        console.error(
          "[CronRecommendations] Failed for user %s:",
          row.userId,
          err,
        );
        summary.failed++;
      }
    }

    return NextResponse.json(summary);
  } catch (err) {
    console.error("[CronRecommendations] Fatal error:", err);
    return NextResponse.json(
      { error: "Internal error", ...summary },
      { status: 500 },
    );
  }
}
