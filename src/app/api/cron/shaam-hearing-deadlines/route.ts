import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { outboundInvoices } from "@/db/schema";
import { sendHearingDeadlineWarning } from "@/lib/shaam/notifications";

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
 * How far ahead of a שימוע deadline to warn.
 *
 * The statutory window is measured in business days and is genuinely
 * short, so a nightly cron has to warn on the first run that sees the
 * deadline at all rather than waiting for a tidy "one day before".
 * Three days gives a weekend room to pass.
 */
const WARN_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Warn sellers whose hearing window is about to close.
 *
 * `shaam_hearing_deadline` has been captured since migration 0041 and
 * nothing watched it — the invoice page showed a countdown to whoever
 * happened to open it, which is not the same as telling the person whose
 * money is at stake. Runs nightly; `sendHearingDeadlineWarning` dedupes on
 * (document, deadline) so re-running is safe and a deadline the ITA moves
 * produces exactly one fresh warning.
 *
 * Only unresolved holds are in scope. Once the document leaves HELD the
 * deadline stops mattering, and `recordResult` clears it on approval.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + WARN_WITHIN_MS);

  const rows = await db
    .select({
      id: outboundInvoices.id,
      businessEntityId: outboundInvoices.businessEntityId,
      formattedNumber: outboundInvoices.formattedNumber,
      deadline: outboundInvoices.shaamHearingDeadline,
    })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.shaamStatus, "HELD"),
        isNotNull(outboundInvoices.shaamHearingDeadline),
        // Still ahead of us, and close enough to be worth a warning. A
        // deadline already past is not warned about: the seller cannot
        // act on it any more, and a late email reads as a reproach.
        gte(outboundInvoices.shaamHearingDeadline, now),
        lte(outboundInvoices.shaamHearingDeadline, horizon),
      ),
    )
    .orderBy(asc(outboundInvoices.shaamHearingDeadline));

  let sent = 0;
  const skipped: string[] = [];
  for (const row of rows) {
    if (!row.deadline) continue;
    try {
      const didSend = await sendHearingDeadlineWarning({
        businessEntityId: row.businessEntityId,
        documentId: row.id,
        formattedNumber: row.formattedNumber,
        deadline: row.deadline,
      });
      if (didSend) sent += 1;
      else skipped.push(row.id);
    } catch (err) {
      console.error(
        `[shaam-hearing-cron] failed for ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({ candidates: rows.length, sent, skipped });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
