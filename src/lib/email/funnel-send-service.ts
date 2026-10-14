import { db } from "@/db";
import { users } from "@/db/schema/users";
import { emailFunnels, emailFunnelSteps } from "@/db/schema/email-funnels";
import { emailTemplates } from "@/db/schema/email-templates";
import { userEmailFunnelStates } from "@/db/schema/user-email-funnel-states";
import { userEmailFunnelHistory } from "@/db/schema/user-email-funnel-history";
import { eq, and } from "drizzle-orm";
import { renderTemplate } from "./template-renderer";
import { sendFunnelEmail } from "./ses";
import { FunnelStatus, FunnelActions } from "./funnel-constants";
import { areEmailFunnelsEnabled } from "./funnel-enabled";
import { resolveEffectiveTier } from "@/lib/effective-tier";

type FunnelState = typeof userEmailFunnelStates.$inferSelect;
type UserRow = typeof users.$inferSelect;

function appUrl(): string {
  return (
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/**
 * Build the variable bag used when rendering a funnel email for a user.
 * Extracted so admin previews can render with the exact same substitutions
 * the cron sender would use.
 */
export async function buildFunnelEmailVariables(
  user: Pick<UserRow, "id" | "email" | "name" | "companyName">,
  extraVars?: Record<string, string>,
): Promise<Record<string, string>> {
  const tier = await resolveEffectiveTier(user.id);
  const base = appUrl();
  return {
    userName: user.name || (user.email ?? "").split("@")[0],
    firstName:
      (user.name || "").split(" ")[0] || (user.email ?? "").split("@")[0],
    userEmail: user.email ?? "",
    appUrl: base,
    companyName: user.companyName || "Invoice Dashboard",
    tierName: tier.tierName,
    tierCode: tier.tierCode,
    tierLimit: String(tier.maxInvoices),
    byokActive: tier.byok ? "true" : "false",
    byokSettingsUrl: `${base}/settings#api-key`,
    upgradeUrl: `${base}/settings#billing`,
    ...extraVars,
  };
}

/**
 * Send the current step's email for a given funnel state, then advance.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendCurrentStepEmail(
  state: FunnelState,
  extraVars?: Record<string, string>,
): Promise<boolean> {
  if (!areEmailFunnelsEnabled()) return false;

  // Load user
  const user = await db.query.users.findFirst({
    where: eq(users.id, state.userId),
  });
  if (!user || !user.email) return false;

  // Load funnel definition
  const funnel = await db.query.emailFunnels.findFirst({
    where: eq(emailFunnels.id, state.funnelId),
  });
  if (!funnel) return false;

  // Next step is currentStep + 1
  const nextStepNumber = state.currentStep + 1;

  const step = await db.query.emailFunnelSteps.findFirst({
    where: and(
      eq(emailFunnelSteps.funnelId, funnel.id),
      eq(emailFunnelSteps.stepNumber, nextStepNumber),
      eq(emailFunnelSteps.isActive, true),
    ),
  });

  if (!step) {
    // No more steps — mark completed
    await markCompleted(state);
    return false;
  }

  // Load template
  const template = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.id, step.emailTemplateId),
  });
  if (!template) return false;

  // Tier info so conversion templates can personalize the copy — e.g.
  // "You've hit your Free plan limit" vs "You've hit your Professional
  // plan limit". Resolved fresh at send time so late-edits to the tier
  // or late BYOK are reflected, rather than whatever was true at entry.
  const variables = await buildFunnelEmailVariables(user, extraVars);

  // Render template in the user's preferred language. Renderer falls back to
  // English when the requested locale row doesn't exist, so partial
  // translations are safe.
  const locale = user.preferredLocale ?? "en";
  const rendered = await renderTemplate(template.code, locale, variables);
  if (!rendered) return false;

  // Send via SES. Pass the *rendered* template id (which is the locale-
  // specific row the renderer actually used) rather than the funnel step's
  // pinned `template.id`, so email_logs accurately reflects which language
  // shipped — without this, Hebrew sends were logged as referencing the
  // English row.
  const logId = await sendFunnelEmail({
    userId: state.userId,
    recipientEmail: user.email,
    rendered,
    templateId: rendered.templateId,
    funnelId: funnel.id,
    funnelStep: nextStepNumber,
    variables,
    isTransactional: funnel.isTransactional,
  });

  if (!logId) return false;

  // Advance to next step
  await advanceStep(state, funnel.id, nextStepNumber);

  // Log history
  await db.insert(userEmailFunnelHistory).values({
    userId: state.userId,
    funnelId: funnel.id,
    action: FunnelActions.STEP_SENT,
    fromStep: state.currentStep,
    toStep: nextStepNumber,
  });

  return true;
}

async function advanceStep(
  state: FunnelState,
  funnelId: string,
  completedStep: number,
): Promise<void> {
  // Check if there's a next step
  const nextStep = await db.query.emailFunnelSteps.findFirst({
    where: and(
      eq(emailFunnelSteps.funnelId, funnelId),
      eq(emailFunnelSteps.stepNumber, completedStep + 1),
      eq(emailFunnelSteps.isActive, true),
    ),
  });

  if (!nextStep) {
    // All steps sent — mark completed
    await db
      .update(userEmailFunnelStates)
      .set({
        currentStep: completedStep,
        status: FunnelStatus.COMPLETED,
        lastStepAt: new Date(),
        nextEmailAt: null,
        exitReason: "all_steps_sent",
        exitedAt: new Date(),
      })
      .where(eq(userEmailFunnelStates.id, state.id));

    await db.insert(userEmailFunnelHistory).values({
      userId: state.userId,
      funnelId,
      action: FunnelActions.COMPLETED,
      fromStep: completedStep,
      reason: "all_steps_sent",
    });
    return;
  }

  // Calculate next email time
  const now = new Date();
  let nextEmailAt: Date;

  if (nextStep.delayFrom === "funnel_entry" && state.enteredAt) {
    nextEmailAt = new Date(
      state.enteredAt.getTime() + nextStep.delayHours * 60 * 60 * 1000,
    );
    // If calculated time is in the past, schedule from now
    if (nextEmailAt <= now) {
      nextEmailAt = new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000);
    }
  } else {
    nextEmailAt = new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000);
  }

  await db
    .update(userEmailFunnelStates)
    .set({
      currentStep: completedStep,
      lastStepAt: now,
      nextEmailAt,
    })
    .where(eq(userEmailFunnelStates.id, state.id));
}

async function markCompleted(state: FunnelState): Promise<void> {
  await db
    .update(userEmailFunnelStates)
    .set({
      status: FunnelStatus.COMPLETED,
      exitReason: "all_steps_sent",
      exitedAt: new Date(),
      nextEmailAt: null,
    })
    .where(eq(userEmailFunnelStates.id, state.id));

  await db.insert(userEmailFunnelHistory).values({
    userId: state.userId,
    funnelId: state.funnelId,
    action: FunnelActions.COMPLETED,
    fromStep: state.currentStep,
    reason: "all_steps_sent",
  });
}
