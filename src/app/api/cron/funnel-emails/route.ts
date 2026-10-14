import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { userEmailFunnelStates } from "@/db/schema/user-email-funnel-states";
import { emailFunnels } from "@/db/schema/email-funnels";
import { emailLogs } from "@/db/schema/email-logs";
import { userEmailPreferences } from "@/db/schema/user-email-preferences";
import { users } from "@/db/schema/users";
import { eq, and, lte, sql, gte } from "drizzle-orm";

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
import { sendCurrentStepEmail } from "@/lib/email/funnel-send-service";
import {
  FunnelStatus,
  FunnelActions,
  ExitReasons,
  MAX_EMAILS_PER_USER_PER_DAY,
  COOLDOWN_HOURS,
  MAX_STALE_HOURS,
} from "@/lib/email/funnel-constants";
import { userEmailFunnelHistory } from "@/db/schema/user-email-funnel-history";
import { areEmailFunnelsEnabled } from "@/lib/email/funnel-enabled";
import { checkUsageLimit } from "@/lib/usage";

/**
 * Self-heal check for conversion funnels (4.1 Approaching Limit, 4.2
 * Limit Reached). The entry events are fired from the upload pipeline
 * based on `checkUsageLimit`; the matching exit conditions
 * (SUBSCRIPTION_STARTED, USER_SET_OWN_KEYS) are only fired by the Stripe
 * webhook and the BYOK settings flow. Anything else that lifts the cap
 * — manual DB tier grant via `scripts/admin-grant-subscription.ts`,
 * monthly counter rollover, an admin clearing usage_tracking — leaves
 * the funnel state stuck `active` and the cron loops it forever via the
 * staleness guard. Re-derive usage here and exit when the entry
 * condition no longer holds.
 */
async function shouldExitConversionFunnel(
  userId: string,
  funnelCode: string,
): Promise<boolean> {
  try {
    const usage = await checkUsageLimit(userId);
    if (usage.limit <= 0) return false;
    const ratio = usage.current / usage.limit;
    if (funnelCode === "4.2") {
      // Entered at usage >= limit. Exit once the user is back under it
      // (upgrade, BYOK, month rollover all qualify).
      return usage.current < usage.limit;
    }
    if (funnelCode === "4.1") {
      // Entered at >= 80%. Use a small hysteresis (70%) to avoid
      // bouncing in/out on tiny usage swings.
      return ratio < 0.7;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * POST /api/cron/funnel-emails
 * Called by an external cron every 15 minutes.
 * Secured with CRON_SECRET bearer token.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!areEmailFunnelsEnabled()) {
    return NextResponse.json({
      disabled: true,
      message: "EMAIL_FUNNELS_ENABLED is off — skipping funnel sends",
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: 0,
    });
  }

  const now = new Date();
  const summary = { processed: 0, sent: 0, skipped: 0, errors: 0 };

  try {
    // Find all due funnel states
    const dueStates = await db
      .select()
      .from(userEmailFunnelStates)
      .where(
        and(
          eq(userEmailFunnelStates.status, FunnelStatus.ACTIVE),
          lte(userEmailFunnelStates.nextEmailAt, now),
        ),
      )
      .limit(100);

    for (const state of dueStates) {
      summary.processed++;

      try {
        // Guard 0: Staleness — skip if >48h overdue
        if (state.nextEmailAt) {
          const hoursOverdue =
            (now.getTime() - state.nextEmailAt.getTime()) / (1000 * 60 * 60);
          if (hoursOverdue > MAX_STALE_HOURS) {
            // Skip this step and reschedule from now
            await db
              .update(userEmailFunnelStates)
              .set({ nextEmailAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) })
              .where(eq(userEmailFunnelStates.id, state.id));
            await db.insert(userEmailFunnelHistory).values({
              userId: state.userId,
              funnelId: state.funnelId,
              action: FunnelActions.STEP_SKIPPED,
              fromStep: state.currentStep,
              reason: `stale_${Math.round(hoursOverdue)}h`,
            });
            summary.skipped++;
            continue;
          }
        }

        // Guard 1: User exists and is active
        const user = await db.query.users.findFirst({
          where: eq(users.id, state.userId),
        });
        if (!user) {
          summary.skipped++;
          continue;
        }

        // Load funnel to check if transactional
        const funnel = await db.query.emailFunnels.findFirst({
          where: eq(emailFunnels.id, state.funnelId),
        });
        const isTransactional = funnel?.isTransactional ?? false;

        // Guard 1.5: Self-heal stuck conversion funnels (see helper above).
        if (
          funnel &&
          funnel.funnelGroup === "conversion" &&
          (await shouldExitConversionFunnel(state.userId, funnel.code))
        ) {
          await exitFunnel(state, ExitReasons.CONDITION_MET);
          summary.skipped++;
          continue;
        }

        if (!isTransactional) {
          // Guard 2: Global unsubscribe
          const prefs = await db.query.userEmailPreferences.findFirst({
            where: eq(userEmailPreferences.userId, state.userId),
          });
          if (prefs?.unsubscribedAll) {
            await exitFunnel(state, ExitReasons.UNSUBSCRIBED_ALL);
            summary.skipped++;
            continue;
          }

          // Guard 3: Daily cap (3 emails/day)
          const todayStart = new Date(now);
          todayStart.setHours(0, 0, 0, 0);
          const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(emailLogs)
            .where(
              and(
                eq(emailLogs.userId, state.userId),
                gte(emailLogs.sentAt, todayStart),
              ),
            );
          if ((countResult?.count ?? 0) >= MAX_EMAILS_PER_USER_PER_DAY) {
            // Reschedule to tomorrow 9am UTC
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            await db
              .update(userEmailFunnelStates)
              .set({ nextEmailAt: tomorrow })
              .where(eq(userEmailFunnelStates.id, state.id));
            summary.skipped++;
            continue;
          }

          // Guard 4: Cooldown (4h between funnel emails)
          const [lastSent] = await db
            .select({ sentAt: emailLogs.sentAt })
            .from(emailLogs)
            .where(
              and(
                eq(emailLogs.userId, state.userId),
                sql`${emailLogs.emailFunnelId} IS NOT NULL`,
              ),
            )
            .orderBy(sql`${emailLogs.sentAt} DESC`)
            .limit(1);

          if (lastSent?.sentAt) {
            const hoursSinceLast =
              (now.getTime() - lastSent.sentAt.getTime()) / (1000 * 60 * 60);
            if (hoursSinceLast < COOLDOWN_HOURS) {
              const remainingMs =
                (COOLDOWN_HOURS - hoursSinceLast) * 60 * 60 * 1000;
              await db
                .update(userEmailFunnelStates)
                .set({
                  nextEmailAt: new Date(now.getTime() + remainingMs),
                })
                .where(eq(userEmailFunnelStates.id, state.id));
              summary.skipped++;
              continue;
            }
          }
        }

        // Guard 5: Idempotency — check if this step was already sent for the
        // *current* funnel entry. Two subtleties:
        //
        // 1) Status filter. The original `status='sent'` was too narrow: SES
        //    flips logs to 'delivered' / 'opened' / 'clicked' over time, and a
        //    second cron pass for a duplicate-state row landed after that
        //    flip and re-sent (this is how a real account received the
        //    limit-reached email twice). Treat anything that isn't
        //    'pending' or 'failed' as "SES accepted it; do not re-send".
        //
        // 2) Time scope. Without this, a future re-entry into a re-entrant
        //    funnel would be permanently blocked by an old send for the same
        //    (user, funnel, step). Scope to logs created since *this* state
        //    row was entered.
        const nextStep = state.currentStep + 1;
        const enteredAt = state.enteredAt ?? new Date(0);
        const [alreadySent] = await db
          .select({ id: emailLogs.id })
          .from(emailLogs)
          .where(
            and(
              eq(emailLogs.userId, state.userId),
              eq(emailLogs.emailFunnelId, state.funnelId),
              eq(emailLogs.funnelStep, nextStep),
              sql`${emailLogs.status} NOT IN ('pending', 'failed')`,
              gte(emailLogs.createdAt, enteredAt),
            ),
          )
          .limit(1);

        if (alreadySent) {
          // Advance step without re-sending
          await db
            .update(userEmailFunnelStates)
            .set({ currentStep: nextStep, lastStepAt: now })
            .where(eq(userEmailFunnelStates.id, state.id));
          summary.skipped++;
          continue;
        }

        // Send the email
        const sent = await sendCurrentStepEmail(state);
        if (sent) {
          summary.sent++;
        } else {
          summary.skipped++;
        }
      } catch (err) {
        console.error("[CronFunnel] Error processing state:", state.id, err);
        summary.errors++;
      }
    }

    return NextResponse.json(summary);
  } catch (err) {
    console.error("[CronFunnel] Fatal error:", err);
    return NextResponse.json(
      { error: "Internal error", ...summary },
      { status: 500 },
    );
  }
}

async function exitFunnel(
  state: typeof userEmailFunnelStates.$inferSelect,
  reason: string,
): Promise<void> {
  await db
    .update(userEmailFunnelStates)
    .set({
      status: FunnelStatus.EXITED,
      exitReason: reason,
      exitedAt: new Date(),
      nextEmailAt: null,
    })
    .where(eq(userEmailFunnelStates.id, state.id));

  await db.insert(userEmailFunnelHistory).values({
    userId: state.userId,
    funnelId: state.funnelId,
    action: FunnelActions.EXITED,
    fromStep: state.currentStep,
    reason,
  });
}
