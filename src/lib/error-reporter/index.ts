import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { errorEvents } from "@/db/schema/error-events";
import { sendImmediateErrorEmail } from "./email";
import {
  ERROR_POLICIES,
  IMMEDIATE_RATE_LIMIT_MINUTES,
  type ErrorKey,
  type ErrorPolicy,
} from "./policies";

export type { ErrorKey } from "./policies";

interface ReportErrorOptions {
  /** Free-form context attached to the row + email body (request id, userId, etc.). */
  context?: Record<string, unknown>;
}

/**
 * Report an error to the owner-notification pipeline.
 *
 * Behavior is decided by `ERROR_POLICIES[key]`:
 *   - `immediate`: insert + email now (rate-limited per fingerprint).
 *   - `digest`:    insert with `sent_at = null`; the daily cron sends.
 *   - `ignore`:    no-op.
 *
 * MUST NOT throw. Error reporting that breaks request handling is worse than
 * no reporting — every failure mode falls back to `console.error`.
 */
export async function reportError(
  key: ErrorKey,
  err: unknown,
  options: ReportErrorOptions = {},
): Promise<void> {
  try {
    const policy: ErrorPolicy = ERROR_POLICIES[key];
    if (policy === "ignore") return;

    const { message, stack } = normalizeError(err);
    const fingerprint = computeFingerprint(key, message);
    const context = options.context ?? null;

    if (policy === "immediate") {
      const recentlyEmailed = await wasRecentlyEmailed(fingerprint);

      const [row] = await db
        .insert(errorEvents)
        .values({
          key,
          fingerprint,
          message,
          stack,
          context,
          policy,
          sentAt: recentlyEmailed ? new Date() : null,
        })
        .returning({ id: errorEvents.id });

      if (recentlyEmailed) return;

      const sent = await sendImmediateErrorEmail({
        key,
        message,
        stack,
        context,
        fingerprint,
      });

      if (sent) {
        await db
          .update(errorEvents)
          .set({ sentAt: new Date() })
          .where(eq(errorEvents.id, row.id));
      }
      return;
    }

    // digest
    await db.insert(errorEvents).values({
      key,
      fingerprint,
      message,
      stack,
      context,
      policy,
      sentAt: null,
    });
  } catch (reporterErr) {
    console.error(
      "[error-reporter] failed to record error:",
      reporterErr instanceof Error ? reporterErr.message : reporterErr,
    );
  }
}

function normalizeError(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) {
    return { message: err.message || err.name, stack: err.stack ?? null };
  }
  if (typeof err === "string") return { message: err, stack: null };
  try {
    return { message: JSON.stringify(err), stack: null };
  } catch {
    return { message: String(err), stack: null };
  }
}

/**
 * Group similar errors. We strip numbers, hex ids, UUIDs, and quoted strings
 * from the message so "user 123 not found" and "user 456 not found" share a
 * fingerprint and don't pager-storm individually.
 */
function computeFingerprint(key: string, message: string): string {
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/"[^"]*"/g, '"<s>"')
    .replace(/'[^']*'/g, "'<s>'")
    .toLowerCase()
    .trim();
  return createHash("sha1").update(`${key}:${normalized}`).digest("hex");
}

async function wasRecentlyEmailed(fingerprint: string): Promise<boolean> {
  const cutoff = new Date(
    Date.now() - IMMEDIATE_RATE_LIMIT_MINUTES * 60 * 1000,
  );
  const [hit] = await db
    .select({ id: errorEvents.id })
    .from(errorEvents)
    .where(
      and(
        eq(errorEvents.fingerprint, fingerprint),
        sql`${errorEvents.sentAt} >= ${cutoff}`,
      ),
    )
    .limit(1);
  return Boolean(hit);
}

