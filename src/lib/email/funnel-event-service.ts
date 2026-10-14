import { db } from "@/db";
import { emailFunnels, emailFunnelExits } from "@/db/schema/email-funnels";
import { userEmailFunnelStates } from "@/db/schema/user-email-funnel-states";
import { userEmailFunnelHistory } from "@/db/schema/user-email-funnel-history";
import { userEmailPreferences } from "@/db/schema/user-email-preferences";
import { emailFunnelSteps } from "@/db/schema/email-funnels";
import { eq, and } from "drizzle-orm";
import {
  FunnelEvents,
  FunnelStatus,
  FunnelActions,
  ExitReasons,
  type FunnelEvent,
} from "./funnel-constants";
import { sendCurrentStepEmail } from "./funnel-send-service";
import { areEmailFunnelsEnabled } from "./funnel-enabled";

/** Postgres unique-violation SQLSTATE — driver-agnostic check. */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

/**
 * Main entry point: fire a funnel event for a user.
 * Processes exits first, then entries — matches Java backend pattern.
 * Always wrapped in try/catch by callers so failures never block main flows.
 */
export async function onFunnelEvent(
  userId: string,
  eventType: FunnelEvent,
  extraVars?: Record<string, string>,
): Promise<void> {
  // Special global events
  if (eventType === FunnelEvents.ACCOUNT_DELETED) {
    await exitAllFunnels(userId, ExitReasons.ACCOUNT_DELETED);
    return;
  }
  if (eventType === FunnelEvents.UNSUBSCRIBED_ALL) {
    await exitAllFunnels(userId, ExitReasons.UNSUBSCRIBED_ALL);
    return;
  }

  // 1. Process exits: check if any active funnel has an exit condition matching this event
  await processExits(userId, eventType);

  // 2. Process entries only when funnel automation is enabled (see EMAIL_FUNNELS_ENABLED)
  if (!areEmailFunnelsEnabled()) return;
  await processEntries(userId, eventType, extraVars);
}

async function processExits(userId: string, eventType: string): Promise<void> {
  const activeStates = await db
    .select()
    .from(userEmailFunnelStates)
    .where(
      and(
        eq(userEmailFunnelStates.userId, userId),
        eq(userEmailFunnelStates.status, FunnelStatus.ACTIVE),
      ),
    );

  for (const state of activeStates) {
    const exits = await db
      .select()
      .from(emailFunnelExits)
      .where(
        and(
          eq(emailFunnelExits.funnelId, state.funnelId),
          eq(emailFunnelExits.exitCondition, eventType),
        ),
      );

    for (const exit of exits) {
      // Exit the funnel
      await db
        .update(userEmailFunnelStates)
        .set({
          status: FunnelStatus.EXITED,
          exitReason: ExitReasons.CONDITION_MET,
          exitedAt: new Date(),
          nextEmailAt: null,
        })
        .where(eq(userEmailFunnelStates.id, state.id));

      await db.insert(userEmailFunnelHistory).values({
        userId,
        funnelId: state.funnelId,
        action: FunnelActions.EXITED,
        fromStep: state.currentStep,
        reason: `exit_condition:${eventType}`,
      });

      // Jump to target funnel if specified
      if (exit.targetFunnelCode) {
        await enterFunnel(userId, exit.targetFunnelCode, `jump_from_exit:${eventType}`);
      }
    }
  }
}

async function processEntries(
  userId: string,
  eventType: string,
  extraVars?: Record<string, string>,
): Promise<void> {
  // Check marketing consent for non-transactional
  const prefs = await db.query.userEmailPreferences.findFirst({
    where: eq(userEmailPreferences.userId, userId),
  });
  const unsubscribedAll = prefs?.unsubscribedAll ?? false;

  const matchingFunnels = await db
    .select()
    .from(emailFunnels)
    .where(
      and(
        eq(emailFunnels.entryEvent, eventType),
        eq(emailFunnels.isActive, true),
      ),
    );

  for (const funnel of matchingFunnels) {
    // Skip non-transactional funnels if user unsubscribed
    if (!funnel.isTransactional && unsubscribedAll) continue;
    await enterFunnel(userId, funnel.code, `event:${eventType}`, extraVars);
  }
}

/**
 * Enter a user into a funnel with all guards from the Java backend.
 */
export async function enterFunnel(
  userId: string,
  funnelCode: string,
  reason: string,
  extraVars?: Record<string, string>,
): Promise<boolean> {
  if (!areEmailFunnelsEnabled()) return false;

  const funnel = await db.query.emailFunnels.findFirst({
    where: and(
      eq(emailFunnels.code, funnelCode),
      eq(emailFunnels.isActive, true),
    ),
  });

  if (!funnel) return false;

  // Guard 1: Re-entry check
  if (!funnel.isReentrant) {
    const history = await db.query.userEmailFunnelHistory.findFirst({
      where: and(
        eq(userEmailFunnelHistory.userId, userId),
        eq(userEmailFunnelHistory.funnelId, funnel.id),
        eq(userEmailFunnelHistory.action, FunnelActions.ENTERED),
      ),
    });
    if (history) return false;
  }

  // Guard 2: Already in this funnel
  const existing = await db.query.userEmailFunnelStates.findFirst({
    where: and(
      eq(userEmailFunnelStates.userId, userId),
      eq(userEmailFunnelStates.funnelId, funnel.id),
      eq(userEmailFunnelStates.status, FunnelStatus.ACTIVE),
    ),
  });
  if (existing) return false;

  // Guard 3: Mutex group — exit competing funnels
  if (funnel.mutexGroup) {
    const competing = await db
      .select({
        id: userEmailFunnelStates.id,
        funnelId: userEmailFunnelStates.funnelId,
        currentStep: userEmailFunnelStates.currentStep,
      })
      .from(userEmailFunnelStates)
      .innerJoin(emailFunnels, eq(userEmailFunnelStates.funnelId, emailFunnels.id))
      .where(
        and(
          eq(userEmailFunnelStates.userId, userId),
          eq(userEmailFunnelStates.status, FunnelStatus.ACTIVE),
          eq(emailFunnels.mutexGroup, funnel.mutexGroup),
        ),
      );

    for (const comp of competing) {
      await db
        .update(userEmailFunnelStates)
        .set({
          status: FunnelStatus.EXITED,
          exitReason: ExitReasons.MUTEX_REPLACED,
          exitedAt: new Date(),
          nextEmailAt: null,
        })
        .where(eq(userEmailFunnelStates.id, comp.id));

      await db.insert(userEmailFunnelHistory).values({
        userId,
        funnelId: comp.funnelId,
        action: FunnelActions.EXITED,
        fromStep: comp.currentStep,
        reason: ExitReasons.MUTEX_REPLACED,
      });
    }
  }

  // Calculate nextEmailAt based on first step
  const firstStep = await db.query.emailFunnelSteps.findFirst({
    where: and(
      eq(emailFunnelSteps.funnelId, funnel.id),
      eq(emailFunnelSteps.stepNumber, 1),
      eq(emailFunnelSteps.isActive, true),
    ),
  });

  const now = new Date();
  const nextEmailAt = firstStep
    ? new Date(now.getTime() + firstStep.delayHours * 60 * 60 * 1000)
    : null;

  // Insert state. The check above ("Already in this funnel") is a non-atomic
  // read-then-write — two concurrent events for the same user+funnel can both
  // pass the read and both attempt the insert (this is exactly how one
  // account ended up with two state rows for funnel 4.2 and received the
  // limit-reached email twice). Partial unique index
  // `uefs_user_funnel_active_unique` enforces single-active at the DB level;
  // catch the race-loser violation and treat it the same as the early-return
  // above so the second caller is a no-op.
  let state: typeof userEmailFunnelStates.$inferSelect | undefined;
  try {
    [state] = await db
      .insert(userEmailFunnelStates)
      .values({
        userId,
        funnelId: funnel.id,
        currentStep: 0,
        status: FunnelStatus.ACTIVE,
        nextEmailAt,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  if (!state) return false;

  // Log history
  await db.insert(userEmailFunnelHistory).values({
    userId,
    funnelId: funnel.id,
    action: FunnelActions.ENTERED,
    toStep: 0,
    reason,
  });

  // Immediate send for transactional funnels with delay=0
  if (funnel.isTransactional && firstStep && firstStep.delayHours === 0) {
    try {
      await sendCurrentStepEmail(state, extraVars);
    } catch (err) {
      console.error("[FunnelEvent] Immediate send failed:", err);
      // Don't fail the entry — email will be retried by cron
    }
  }

  return true;
}

async function exitAllFunnels(userId: string, reason: string): Promise<void> {
  const active = await db
    .select()
    .from(userEmailFunnelStates)
    .where(
      and(
        eq(userEmailFunnelStates.userId, userId),
        eq(userEmailFunnelStates.status, FunnelStatus.ACTIVE),
      ),
    );

  for (const state of active) {
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
      userId,
      funnelId: state.funnelId,
      action: FunnelActions.EXITED,
      fromStep: state.currentStep,
      reason,
    });
  }
}
