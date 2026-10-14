import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { archiveObjects } from "@/db/schema";
import { verifyArchiveChain } from "@/lib/archive/verify";

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
 * Walk the archive hash chain for every business entity that has at
 * least one archived object. Emits a summary + logs ERROR lines for
 * any broken chain so external alerting can pick it up. Designed for
 * daily invocation.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entities = await db
    .selectDistinct({ businessEntityId: archiveObjects.businessEntityId })
    .from(archiveObjects);

  const brokenEntities: Array<{
    businessEntityId: string;
    brokenAt: number;
    reason: string;
  }> = [];

  for (const row of entities) {
    const result = await verifyArchiveChain(row.businessEntityId);
    if (!result.ok) {
      brokenEntities.push({
        businessEntityId: row.businessEntityId,
        brokenAt: result.brokenAt,
        reason: result.reason,
      });
      console.error(
        `[archive-chain] BROKEN business_entity_id=${row.businessEntityId} broken_at=${result.brokenAt} reason=${result.reason}`,
      );
    }
  }

  return NextResponse.json({
    entitiesChecked: entities.length,
    anyBroken: brokenEntities.length > 0,
    brokenEntities,
  });
}

// GET is gated behind the same secret so dev probes are convenient.
export async function GET(req: NextRequest) {
  return POST(req);
}
