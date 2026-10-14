import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, asc, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { errorEvents } from "@/db/schema/error-events";
import { sendDigestErrorEmail } from "@/lib/error-reporter/email";

/** Constant-time bearer-token check; mirrors the other cron routes. */
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
 * POST /api/cron/error-digest
 *
 * Collapses unsent `digest`-policy `error_events` rows from the last 24h by
 * fingerprint, sends one summary email to the owner, then marks the
 * collapsed rows as sent. Intended to run once a day.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const pending = await db
      .select()
      .from(errorEvents)
      .where(
        and(
          isNull(errorEvents.sentAt),
          gte(errorEvents.createdAt, since),
        ),
      )
      .orderBy(asc(errorEvents.createdAt));

    if (pending.length === 0) {
      return NextResponse.json({ sent: false, rows: 0, groups: 0 });
    }

    const groups = new Map<
      string,
      {
        key: string;
        fingerprint: string;
        ids: string[];
        firstSeen: Date;
        lastSeen: Date;
        sampleMessage: string;
        sampleStack: string | null;
        sampleContext: Record<string, unknown> | null;
      }
    >();

    for (const row of pending) {
      const existing = groups.get(row.fingerprint);
      if (!existing) {
        groups.set(row.fingerprint, {
          key: row.key,
          fingerprint: row.fingerprint,
          ids: [row.id],
          firstSeen: row.createdAt,
          lastSeen: row.createdAt,
          sampleMessage: row.message,
          sampleStack: row.stack,
          sampleContext: row.context,
        });
      } else {
        existing.ids.push(row.id);
        if (row.createdAt < existing.firstSeen) existing.firstSeen = row.createdAt;
        if (row.createdAt > existing.lastSeen) existing.lastSeen = row.createdAt;
      }
    }

    const digestRows = Array.from(groups.values())
      .map((g) => ({
        key: g.key,
        fingerprint: g.fingerprint,
        count: g.ids.length,
        firstSeen: g.firstSeen,
        lastSeen: g.lastSeen,
        sampleMessage: g.sampleMessage,
        sampleStack: g.sampleStack,
        sampleContext: g.sampleContext,
      }))
      .sort((a, b) => b.count - a.count);

    const sent = await sendDigestErrorEmail(digestRows);
    if (!sent) {
      // Leave rows pending so the next run retries them. Don't 500 — a missing
      // SES config shouldn't trip the cron's failure alarms.
      return NextResponse.json(
        { sent: false, rows: pending.length, groups: groups.size },
        { status: 200 },
      );
    }

    const allIds = pending.map((r) => r.id);
    await db
      .update(errorEvents)
      .set({ sentAt: sql`now()` })
      .where(inArray(errorEvents.id, allIds));

    return NextResponse.json({
      sent: true,
      rows: pending.length,
      groups: groups.size,
    });
  } catch (err) {
    console.error("[cron error-digest] fatal:", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
