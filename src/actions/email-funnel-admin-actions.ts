"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { isUserAdmin } from "@/lib/is-user-admin";
import {
  emailFunnels,
  emailFunnelSteps,
  emailFunnelExits,
} from "@/db/schema/email-funnels";
import { emailTemplates } from "@/db/schema/email-templates";
import { userEmailFunnelStates } from "@/db/schema/user-email-funnel-states";
import { userEmailFunnelHistory } from "@/db/schema/user-email-funnel-history";
import { emailLogs } from "@/db/schema/email-logs";
import { users } from "@/db/schema/users";
import {
  eq,
  and,
  ilike,
  or,
  desc,
  asc,
  sql,
  lte,
  inArray,
  isNull,
  isNotNull,
} from "drizzle-orm";
import { FUNNEL_GROUPS } from "@/lib/email/funnel-constants";
import { revalidatePath } from "next/cache";
import { renderTemplate } from "@/lib/email/template-renderer";
import { buildFunnelEmailVariables } from "@/lib/email/funnel-send-service";

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const admin = await isUserAdmin(session.user.id);
  return admin ? session.user.id : null;
}

// ── Types ───────────────────────────────────────────────────────────

export interface AdminFunnelGroup {
  key: string;
  label: string;
  color: string;
  accent: string;
  count: number;
}

export interface AdminFunnel {
  id: string;
  code: string;
  name: string;
  funnelGroup: string;
  description: string | null;
  entryEvent: string | null;
  mutexGroup: string | null;
  isActive: boolean;
  isTransactional: boolean;
  steps: AdminFunnelStep[];
  exits: AdminFunnelExit[];
}

export interface AdminFunnelStep {
  id: string;
  stepNumber: number;
  delayHours: number;
  delayFrom: string;
  isActive: boolean;
  templateCode: string;
  templateName: string;
  subject: string;
}

export interface AdminFunnelExit {
  id: string;
  exitCondition: string;
  targetFunnelCode: string | null;
  isSuccess: boolean;
  description: string | null;
}

export interface AdminUserSearch {
  id: string;
  email: string;
  name: string | null;
}

export interface AdminUserFunnelState {
  stateId: string;
  funnelCode: string;
  funnelName: string;
  funnelGroup: string;
  currentStep: number;
  status: string;
  enteredAt: Date | null;
  nextEmailAt: Date | null;
}

export interface AdminUserEmail {
  id: string;
  funnelCode: string | null;
  funnelStep: number | null;
  templateName: string;
  subject: string | null;
  recipientEmail: string;
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  openCount: number;
  clickCount: number;
}

export interface AdminPlannedEmail {
  userId: string;
  userName: string | null;
  userEmail: string;
  funnelCode: string;
  funnelName: string;
  funnelGroup: string;
  currentStep: number;
  nextStepNumber: number;
  nextStepTemplateName: string;
  nextStepSubject: string;
  nextEmailAt: Date;
  delayHours: number;
}

// ── Actions ─────────────────────────────────────────────────────────

export async function getFunnelGroups(): Promise<AdminFunnelGroup[]> {
  if (!(await requireAdmin())) return [];

  const allFunnels = await db.select().from(emailFunnels);
  const counts = new Map<string, number>();
  for (const f of allFunnels) {
    counts.set(f.funnelGroup, (counts.get(f.funnelGroup) ?? 0) + 1);
  }

  return FUNNEL_GROUPS.map((g) => ({
    ...g,
    count: counts.get(g.key) ?? 0,
  }));
}

export async function getAllFunnels(): Promise<AdminFunnel[]> {
  if (!(await requireAdmin())) return [];

  const funnels = await db
    .select()
    .from(emailFunnels)
    .orderBy(asc(emailFunnels.funnelGroup), asc(emailFunnels.code));

  const result: AdminFunnel[] = [];

  for (const funnel of funnels) {
    const steps = await db
      .select({
        id: emailFunnelSteps.id,
        stepNumber: emailFunnelSteps.stepNumber,
        delayHours: emailFunnelSteps.delayHours,
        delayFrom: emailFunnelSteps.delayFrom,
        isActive: emailFunnelSteps.isActive,
        templateCode: emailTemplates.code,
        templateName: emailTemplates.name,
        subject: emailTemplates.subject,
      })
      .from(emailFunnelSteps)
      .innerJoin(
        emailTemplates,
        eq(emailFunnelSteps.emailTemplateId, emailTemplates.id),
      )
      .where(eq(emailFunnelSteps.funnelId, funnel.id))
      .orderBy(asc(emailFunnelSteps.stepNumber));

    const exits = await db
      .select()
      .from(emailFunnelExits)
      .where(eq(emailFunnelExits.funnelId, funnel.id));

    result.push({
      id: funnel.id,
      code: funnel.code,
      name: funnel.name,
      funnelGroup: funnel.funnelGroup,
      description: funnel.description,
      entryEvent: funnel.entryEvent,
      mutexGroup: funnel.mutexGroup,
      isActive: funnel.isActive,
      isTransactional: funnel.isTransactional,
      steps: steps.map((s) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        delayHours: s.delayHours,
        delayFrom: s.delayFrom,
        isActive: s.isActive,
        templateCode: s.templateCode,
        templateName: s.templateName,
        subject: s.subject,
      })),
      exits: exits.map((e) => ({
        id: e.id,
        exitCondition: e.exitCondition,
        targetFunnelCode: e.targetFunnelCode,
        isSuccess: e.isSuccess,
        description: e.description,
      })),
    });
  }

  return result;
}

export async function searchFunnelUsers(
  query: string,
): Promise<AdminUserSearch[]> {
  if (!(await requireAdmin())) return [];
  if (!query || query.length < 2) return [];

  const results = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(
      or(
        ilike(users.email, `%${query}%`),
        ilike(users.name, `%${query}%`),
      ),
    )
    .limit(20);

  return results;
}

export async function getUserActiveFunnels(
  userId: string,
): Promise<AdminUserFunnelState[]> {
  if (!(await requireAdmin())) return [];

  const states = await db
    .select({
      stateId: userEmailFunnelStates.id,
      funnelCode: emailFunnels.code,
      funnelName: emailFunnels.name,
      funnelGroup: emailFunnels.funnelGroup,
      currentStep: userEmailFunnelStates.currentStep,
      status: userEmailFunnelStates.status,
      enteredAt: userEmailFunnelStates.enteredAt,
      nextEmailAt: userEmailFunnelStates.nextEmailAt,
    })
    .from(userEmailFunnelStates)
    .innerJoin(
      emailFunnels,
      eq(userEmailFunnelStates.funnelId, emailFunnels.id),
    )
    .where(eq(userEmailFunnelStates.userId, userId))
    .orderBy(desc(userEmailFunnelStates.enteredAt));

  return states;
}

export async function getUserEmailHistory(
  userId: string,
): Promise<AdminUserEmail[]> {
  if (!(await requireAdmin())) return [];

  const logs = await db
    .select({
      id: emailLogs.id,
      funnelCode: emailFunnels.code,
      funnelStep: emailLogs.funnelStep,
      templateName: emailTemplates.name,
      subject: emailLogs.subjectSnapshot,
      recipientEmail: emailLogs.recipientEmail,
      status: emailLogs.status,
      sentAt: emailLogs.sentAt,
      deliveredAt: emailLogs.deliveredAt,
      openedAt: emailLogs.openedAt,
      clickedAt: emailLogs.clickedAt,
      openCount: emailLogs.openCount,
      clickCount: emailLogs.clickCount,
    })
    .from(emailLogs)
    .innerJoin(emailTemplates, eq(emailLogs.emailTemplateId, emailTemplates.id))
    .leftJoin(emailFunnels, eq(emailLogs.emailFunnelId, emailFunnels.id))
    .where(eq(emailLogs.userId, userId))
    .orderBy(desc(emailLogs.createdAt))
    .limit(50);

  return logs.map((l) => ({
    ...l,
    funnelCode: l.funnelCode ?? null,
  }));
}

export async function getPlannedEmails(filters?: {
  funnelGroup?: string;
  userId?: string;
}): Promise<AdminPlannedEmail[]> {
  if (!(await requireAdmin())) return [];

  const now = new Date();

  const query = db
    .select({
      userId: userEmailFunnelStates.userId,
      userName: users.name,
      userEmail: users.email,
      funnelCode: emailFunnels.code,
      funnelName: emailFunnels.name,
      funnelGroup: emailFunnels.funnelGroup,
      currentStep: userEmailFunnelStates.currentStep,
      nextEmailAt: userEmailFunnelStates.nextEmailAt,
    })
    .from(userEmailFunnelStates)
    .innerJoin(emailFunnels, eq(userEmailFunnelStates.funnelId, emailFunnels.id))
    .innerJoin(users, eq(userEmailFunnelStates.userId, users.id))
    .where(
      and(
        eq(userEmailFunnelStates.status, "active"),
        sql`${userEmailFunnelStates.nextEmailAt} IS NOT NULL`,
        ...(filters?.funnelGroup
          ? [eq(emailFunnels.funnelGroup, filters.funnelGroup)]
          : []),
        ...(filters?.userId
          ? [eq(userEmailFunnelStates.userId, filters.userId)]
          : []),
      ),
    )
    .orderBy(asc(userEmailFunnelStates.nextEmailAt))
    .limit(100);

  const states = await query;

  const result: AdminPlannedEmail[] = [];

  for (const state of states) {
    if (!state.nextEmailAt) continue;

    const nextStepNumber = state.currentStep + 1;
    const step = await db
      .select({
        templateName: emailTemplates.name,
        subject: emailTemplates.subject,
        delayHours: emailFunnelSteps.delayHours,
      })
      .from(emailFunnelSteps)
      .innerJoin(
        emailTemplates,
        eq(emailFunnelSteps.emailTemplateId, emailTemplates.id),
      )
      .innerJoin(emailFunnels, eq(emailFunnelSteps.funnelId, emailFunnels.id))
      .where(
        and(
          eq(emailFunnels.code, state.funnelCode),
          eq(emailFunnelSteps.stepNumber, nextStepNumber),
        ),
      )
      .limit(1);

    const s = step[0];
    if (!s) continue;

    result.push({
      userId: state.userId,
      userName: state.userName,
      userEmail: state.userEmail,
      funnelCode: state.funnelCode,
      funnelName: state.funnelName,
      funnelGroup: state.funnelGroup,
      currentStep: state.currentStep,
      nextStepNumber,
      nextStepTemplateName: s.templateName,
      nextStepSubject: s.subject,
      nextEmailAt: state.nextEmailAt,
      delayHours: s.delayHours,
    });
  }

  return result;
}

export async function setFunnelActive(
  funnelId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: "not_admin" | "not_found" }> {
  if (!(await requireAdmin())) return { ok: false, error: "not_admin" };

  const updated = await db
    .update(emailFunnels)
    .set({ isActive: active })
    .where(eq(emailFunnels.id, funnelId))
    .returning({ id: emailFunnels.id });

  if (updated.length === 0) {
    return { ok: false, error: "not_found" };
  }

  // The funnels UI lives at /admin/email-funnels. This pointed at the expense
  // dashboard, which never rendered a funnel — so toggling one left the admin
  // list showing the old state until a hard reload.
  revalidatePath("/admin/email-funnels");
  return { ok: true };
}

export interface EmailPreviewData {
  subject: string;
  html: string;
  text?: string;
}

/**
 * Preview an email template with sample variables.
 */
export async function previewEmailTemplate(
  templateCode: string,
): Promise<EmailPreviewData | null> {
  if (!(await requireAdmin())) return null;

  const template = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.code, templateCode),
  });

  if (!template) return null;

  // Replace variables with sample values
  const sampleVars: Record<string, string> = {
    userName: "Jane Doe",
    firstName: "Jane",
    userEmail: "jane@example.com",
    companyName: "Invoice Dashboard",
    appUrl: process.env.AUTH_URL?.trim() || "https://involoops.com",
  };

  function replaceVars(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key === "amazonSESUnsubscribeUrl") return "#";
      return sampleVars[key] ?? match;
    });
  }

  return {
    subject: replaceVars(template.subject),
    html: replaceVars(template.bodyHtml),
    text: template.bodyText ? replaceVars(template.bodyText) : undefined,
  };
}

// ── Sent emails ─────────────────────────────────────────────────────
//
// Exact-email history for admins. Reconstruction model: we persist
// `subjectSnapshot` + `variablesSnapshot` on every send, then re-render
// the current template body with those variables on demand. This drifts
// if the template is edited after the send — acceptable for now; if
// bit-exact fidelity is needed later, add a `bodyHtmlSnapshot` column
// and populate it at send time.

export interface AdminSentEmail {
  id: string;
  funnelCode: string | null;
  funnelName: string | null;
  funnelStep: number | null;
  templateCode: string;
  templateName: string;
  subject: string | null;
  recipientEmail: string;
  userId: string;
  userName: string | null;
  status: string;
  sentAt: Date | null;
  createdAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
  openCount: number;
  clickCount: number;
  /** Total emails (transactional + funnel) ever sent to this user. */
  userTotalSent: number;
}

export interface SentEmailsPage {
  rows: AdminSentEmail[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Engagement is *orthogonal* to `status` (which is the delivery lifecycle).
 * SES reports opens and clicks as separate events that don't replace the
 * "delivered" status — see `src/app/api/webhooks/ses/route.ts`. So we
 * filter on the timestamp columns the webhook stamps:
 *   - "opened"  -> opened_at  IS NOT NULL
 *   - "clicked" -> clicked_at IS NOT NULL
 *   - "none"    -> delivered but neither opened nor clicked (the
 *                  "ghost recipient" case — useful to spot dead inboxes
 *                  or templates whose subject lines aren't pulling).
 */
export type SentEmailsEngagement = "opened" | "clicked" | "none";

export interface SentEmailsFilters {
  search?: string;
  funnelId?: string;
  status?: string;
  engagement?: SentEmailsEngagement;
  limit?: number;
  offset?: number;
}

export async function listSentEmails(
  filters: SentEmailsFilters = {},
): Promise<SentEmailsPage> {
  const empty: SentEmailsPage = {
    rows: [],
    total: 0,
    limit: filters.limit ?? 50,
    offset: filters.offset ?? 0,
  };
  if (!(await requireAdmin())) return empty;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const engagementCondition = (() => {
    switch (filters.engagement) {
      case "opened":
        return isNotNull(emailLogs.openedAt);
      case "clicked":
        return isNotNull(emailLogs.clickedAt);
      case "none":
        // "Delivered but never engaged with" — exclude rows that
        // never made it to the inbox (pending/failed/bounced) since
        // their lack of opens isn't meaningful.
        return and(
          eq(emailLogs.status, "delivered"),
          isNull(emailLogs.openedAt),
          isNull(emailLogs.clickedAt),
        )!;
      default:
        return null;
    }
  })();

  const conditions = [
    ...(filters.funnelId ? [eq(emailLogs.emailFunnelId, filters.funnelId)] : []),
    ...(filters.status ? [eq(emailLogs.status, filters.status)] : []),
    ...(engagementCondition ? [engagementCondition] : []),
    ...(filters.search
      ? [
          or(
            ilike(emailLogs.recipientEmail, `%${filters.search}%`),
            ilike(users.name, `%${filters.search}%`),
            ilike(emailLogs.subjectSnapshot, `%${filters.search}%`),
          )!,
        ]
      : []),
  ];
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select({
      id: emailLogs.id,
      funnelCode: emailFunnels.code,
      funnelName: emailFunnels.name,
      funnelStep: emailLogs.funnelStep,
      templateCode: emailTemplates.code,
      templateName: emailTemplates.name,
      subject: emailLogs.subjectSnapshot,
      recipientEmail: emailLogs.recipientEmail,
      userId: emailLogs.userId,
      userName: users.name,
      status: emailLogs.status,
      sentAt: emailLogs.sentAt,
      createdAt: emailLogs.createdAt,
      deliveredAt: emailLogs.deliveredAt,
      openedAt: emailLogs.openedAt,
      clickedAt: emailLogs.clickedAt,
      bouncedAt: emailLogs.bouncedAt,
      openCount: emailLogs.openCount,
      clickCount: emailLogs.clickCount,
    })
    .from(emailLogs)
    .innerJoin(emailTemplates, eq(emailLogs.emailTemplateId, emailTemplates.id))
    .innerJoin(users, eq(emailLogs.userId, users.id))
    .leftJoin(emailFunnels, eq(emailLogs.emailFunnelId, emailFunnels.id));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailLogs)
    .innerJoin(emailTemplates, eq(emailLogs.emailTemplateId, emailTemplates.id))
    .innerJoin(users, eq(emailLogs.userId, users.id))
    .leftJoin(emailFunnels, eq(emailLogs.emailFunnelId, emailFunnels.id));

  const [rows, totalRows] = await Promise.all([
    whereClause
      ? rowsQuery
          .where(whereClause)
          .orderBy(desc(emailLogs.sentAt), desc(emailLogs.createdAt))
          .limit(limit)
          .offset(offset)
      : rowsQuery
          .orderBy(desc(emailLogs.sentAt), desc(emailLogs.createdAt))
          .limit(limit)
          .offset(offset),
    whereClause ? countQuery.where(whereClause) : countQuery,
  ]);

  // emailLogs.userId is nullable (admin-recipient transactional emails carry
  // no recipient user). The query above uses innerJoin(users) so `rows` only
  // contains user-attached logs at runtime — but TS still types `r.userId` as
  // string|null based on the column. Filter explicitly so inArray's overload
  // resolves and the totals map keys stay non-nullable.
  const userIds = Array.from(
    new Set(rows.map((r) => r.userId).filter((id): id is string => id !== null)),
  );
  const totalsByUser = new Map<string, number>();
  if (userIds.length > 0) {
    const totals = await db
      .select({
        userId: emailLogs.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(emailLogs)
      .where(
        and(
          inArray(emailLogs.userId, userIds),
          sql`${emailLogs.sentAt} IS NOT NULL`,
        ),
      )
      .groupBy(emailLogs.userId);
    for (const t of totals) {
      if (t.userId) totalsByUser.set(t.userId, t.count);
    }
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      // innerJoin(users) above guarantees a non-null userId at runtime even
      // though the column type is now nullable.
      userId: r.userId as string,
      funnelCode: r.funnelCode ?? null,
      funnelName: r.funnelName ?? null,
      userTotalSent: r.userId ? (totalsByUser.get(r.userId) ?? 0) : 0,
    })),
    total: totalRows[0]?.count ?? 0,
    limit,
    offset,
  };
}

export interface SentEmailDetails {
  id: string;
  subject: string;
  html: string;
  text: string | null;
  variables: Record<string, string>;
  recipientEmail: string;
  userName: string | null;
  userEmail: string;
  funnelCode: string | null;
  funnelName: string | null;
  funnelStep: number | null;
  templateCode: string;
  templateName: string;
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
  sesMessageId: string | null;
  errorMessage: string | null;
  /**
   * True when the current template no longer exists OR the saved
   * variables couldn't be parsed — in those cases `html`/`text` fall
   * back to the raw (unrendered) template body or empty strings.
   */
  reconstructed: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderWithVars(
  text: string,
  variables: Record<string, string>,
  escape: boolean,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key === "amazonSESUnsubscribeUrl") return "#";
    const value = variables[key];
    if (value === undefined) return match;
    return escape ? escapeHtml(value) : value;
  });
}

export async function getSentEmailDetails(
  logId: string,
): Promise<SentEmailDetails | null> {
  if (!(await requireAdmin())) return null;

  const [row] = await db
    .select({
      id: emailLogs.id,
      subjectSnapshot: emailLogs.subjectSnapshot,
      variablesSnapshot: emailLogs.variablesSnapshot,
      recipientEmail: emailLogs.recipientEmail,
      userName: users.name,
      userEmail: users.email,
      funnelCode: emailFunnels.code,
      funnelName: emailFunnels.name,
      funnelStep: emailLogs.funnelStep,
      templateCode: emailTemplates.code,
      templateName: emailTemplates.name,
      templateSubject: emailTemplates.subject,
      templateBodyHtml: emailTemplates.bodyHtml,
      templateBodyText: emailTemplates.bodyText,
      status: emailLogs.status,
      sentAt: emailLogs.sentAt,
      deliveredAt: emailLogs.deliveredAt,
      openedAt: emailLogs.openedAt,
      clickedAt: emailLogs.clickedAt,
      bouncedAt: emailLogs.bouncedAt,
      sesMessageId: emailLogs.sesMessageId,
      errorMessage: emailLogs.errorMessage,
    })
    .from(emailLogs)
    .innerJoin(emailTemplates, eq(emailLogs.emailTemplateId, emailTemplates.id))
    .innerJoin(users, eq(emailLogs.userId, users.id))
    .leftJoin(emailFunnels, eq(emailLogs.emailFunnelId, emailFunnels.id))
    .where(eq(emailLogs.id, logId))
    .limit(1);

  if (!row) return null;

  const variables: Record<string, string> = {};
  let reconstructed = false;
  if (row.variablesSnapshot) {
    try {
      const parsed = JSON.parse(row.variablesSnapshot);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          variables[k] = typeof v === "string" ? v : String(v);
        }
      }
    } catch {
      reconstructed = true;
    }
  }

  // Subject snapshot is the authoritative "what was sent"; fall back
  // to re-rendering the current template subject if it's missing.
  const subject =
    row.subjectSnapshot ?? renderWithVars(row.templateSubject, variables, false);
  const html = renderWithVars(row.templateBodyHtml, variables, true);
  const text = row.templateBodyText
    ? renderWithVars(row.templateBodyText, variables, false)
    : null;

  return {
    id: row.id,
    subject,
    html,
    text,
    variables,
    recipientEmail: row.recipientEmail,
    userName: row.userName,
    userEmail: row.userEmail,
    funnelCode: row.funnelCode ?? null,
    funnelName: row.funnelName ?? null,
    funnelStep: row.funnelStep,
    templateCode: row.templateCode,
    templateName: row.templateName,
    status: row.status,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    openedAt: row.openedAt,
    clickedAt: row.clickedAt,
    bouncedAt: row.bouncedAt,
    sesMessageId: row.sesMessageId,
    errorMessage: row.errorMessage,
    reconstructed,
  };
}

export interface AdminFunnelOption {
  id: string;
  code: string;
  name: string;
  group: string;
}

// ── Planned email preview & user lookup ────────────────────────────

export interface PlannedEmailPreview {
  subject: string;
  html: string;
  text: string | null;
  variables: Record<string, string>;
  /** Locale actually rendered (may differ from requested if missing). */
  resolvedLocale: string;
  requestedLocale: string;
  /** True when the requested locale row was missing and we fell back to "en". */
  localeFallback: boolean;
  recipientEmail: string;
  userName: string | null;
  funnelCode: string;
  funnelName: string;
  templateCode: string;
  templateName: string;
  stepNumber: number;
  scheduledAt: Date | null;
}

/**
 * Render the next planned funnel step for `userId` exactly the way the cron
 * sender would render it — same variable bag, same locale resolution. Lets
 * admins inspect "what is queued to go out next".
 */
export async function getPlannedEmailPreview(
  userId: string,
  funnelCode: string,
): Promise<PlannedEmailPreview | null> {
  if (!(await requireAdmin())) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user || !user.email) return null;

  const funnel = await db.query.emailFunnels.findFirst({
    where: eq(emailFunnels.code, funnelCode),
  });
  if (!funnel) return null;

  const state = await db.query.userEmailFunnelStates.findFirst({
    where: and(
      eq(userEmailFunnelStates.userId, userId),
      eq(userEmailFunnelStates.funnelId, funnel.id),
    ),
  });
  if (!state) return null;

  const nextStepNumber = state.currentStep + 1;
  const stepRow = await db
    .select({
      templateCode: emailTemplates.code,
      templateName: emailTemplates.name,
    })
    .from(emailFunnelSteps)
    .innerJoin(
      emailTemplates,
      eq(emailFunnelSteps.emailTemplateId, emailTemplates.id),
    )
    .where(
      and(
        eq(emailFunnelSteps.funnelId, funnel.id),
        eq(emailFunnelSteps.stepNumber, nextStepNumber),
      ),
    )
    .limit(1);

  const step = stepRow[0];
  if (!step) return null;

  const requestedLocale = user.preferredLocale ?? "en";
  const variables = await buildFunnelEmailVariables({
    id: user.id,
    email: user.email,
    name: user.name,
    companyName: user.companyName,
  });

  const rendered = await renderTemplate(
    step.templateCode,
    requestedLocale,
    variables,
  );
  if (!rendered) return null;

  // Detect locale fallback: if the requested locale row doesn't exist
  // (or is inactive) the renderer falls back to "en". Probe directly so
  // we can flag it in the UI.
  let resolvedLocale = requestedLocale;
  let localeFallback = false;
  if (requestedLocale !== "en") {
    const localized = await db.query.emailTemplates.findFirst({
      where: and(
        eq(emailTemplates.code, step.templateCode),
        eq(emailTemplates.locale, requestedLocale),
        eq(emailTemplates.isActive, true),
      ),
    });
    if (!localized) {
      resolvedLocale = "en";
      localeFallback = true;
    }
  }

  return {
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text ?? null,
    variables,
    resolvedLocale,
    requestedLocale,
    localeFallback,
    recipientEmail: user.email,
    userName: user.name,
    funnelCode: funnel.code,
    funnelName: funnel.name,
    templateCode: step.templateCode,
    templateName: step.templateName,
    stepNumber: nextStepNumber,
    scheduledAt: state.nextEmailAt,
  };
}

/**
 * Look up a user by id for admin deep-links (e.g. clicking a planned
 * email row to jump into the funnels page with that user pre-selected).
 */
export async function getFunnelUserById(
  userId: string,
): Promise<AdminUserSearch | null> {
  if (!(await requireAdmin())) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function listFunnelOptions(): Promise<AdminFunnelOption[]> {
  if (!(await requireAdmin())) return [];
  const rows = await db
    .select({
      id: emailFunnels.id,
      code: emailFunnels.code,
      name: emailFunnels.name,
      group: emailFunnels.funnelGroup,
    })
    .from(emailFunnels)
    .orderBy(asc(emailFunnels.funnelGroup), asc(emailFunnels.code));
  return rows;
}
