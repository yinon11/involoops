/**
 * AI Recommendations Engine
 *
 * Generates financial recommendations for a user via two stages:
 *   1. Rule-based checks   — instant, no AI, always run
 *   2. Anthropic-powered   — contextual, skipped when no key available
 *
 * Designed to run as a background task (fire-and-forget or from cron).
 * Never blocks the UI — callers must NOT await at the request level.
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  businessEntities,
  invoices,
  outboundInvoices,
  projectMilestones,
  projects,
  recommendations,
  users,
} from "@/db/schema";
import { resolveAnthropicApiKey } from "@/lib/user-api-key";
import { revenueSumExpr } from "@/lib/outbound/revenue";
import type {
  RecommendationPriority,
  RecommendationType,
} from "@/db/schema/recommendations";

// ─── Constants ────────────────────────────────────────────────────────────────

// Sonnet 4 (claude-sonnet-4-20250514) was retired by Anthropic on 2026-06-15;
// claude-sonnet-4-6 is the recommended replacement.
const RECOMMENDATION_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

// Rule-based recs: deduplicate within 24 h; AI recs: within 7 days.
const RULE_DEDUP_MS = 24 * 60 * 60 * 1000;
const AI_DEDUP_MS = 7 * 24 * 60 * 60 * 1000;

const DISCLAIMER =
  " (הערכה זו אינה תחליף לייעוץ מקצועי / This is an estimate only and does not replace professional advice.)";

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface RawRecommendation {
  type: RecommendationType;
  title: string;
  body: string;
  priority: RecommendationPriority;
  isAiGenerated?: boolean;
  metadata?: Record<string, unknown>;
}

async function isDuplicate(
  userId: string,
  type: RecommendationType,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, userId),
        eq(recommendations.type, type),
        isNull(recommendations.dismissedAt),
        gte(recommendations.createdAt, since),
      ),
    )
    .limit(1);
  return !!row;
}

async function insertRecommendations(
  userId: string,
  recs: RawRecommendation[],
  isAiGenerated: boolean,
): Promise<void> {
  const windowMs = isAiGenerated ? AI_DEDUP_MS : RULE_DEDUP_MS;
  for (const rec of recs) {
    if (await isDuplicate(userId, rec.type, windowMs)) continue;
    await db.insert(recommendations).values({
      userId,
      type: rec.type,
      title: rec.title,
      body: rec.body,
      priority: rec.priority,
      metadata: rec.metadata ?? {},
    });
  }
}

/** One live card per summary type. Older undismissed copies are closed. */
const SINGLETON_TYPES: RecommendationType[] = [
  "overdue_invoice",
  "weekly_digest",
  "vat_refund",
  "missing_expense",
  "tax_bracket",
];

async function dismissAllOfType(
  userId: string,
  type: RecommendationType,
): Promise<void> {
  await db
    .update(recommendations)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(recommendations.userId, userId),
        eq(recommendations.type, type),
        isNull(recommendations.dismissedAt),
      ),
    );
}

async function keepLatestOfType(
  userId: string,
  type: RecommendationType,
): Promise<void> {
  const rows = await db
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, userId),
        eq(recommendations.type, type),
        isNull(recommendations.dismissedAt),
      ),
    )
    .orderBy(desc(recommendations.createdAt));
  const older = rows.slice(1);
  if (older.length === 0) return;
  await db
    .update(recommendations)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(recommendations.userId, userId),
        inArray(
          recommendations.id,
          older.map((r) => r.id),
        ),
      ),
    );
}

// ─── Context gathering ────────────────────────────────────────────────────────

interface EngineContext {
  // Entity
  businessEntityId: string | null;
  currency: string;

  // Overdue / open invoices
  overdueCount: number; // collectible tax invoices, 90+ days past due
  openInvoicesTotal: number;
  overdueTotal: number;
  overdueCurrency: string | null;
  overdueInvoiceIds: string[];

  // Milestones
  upcomingMilestones: Array<{
    id: string;
    title: string;
    daysUntilDue: number;
    amount: string;
    projectName: string;
  }>;
  overdueMilestoneIds: string[];

  // VAT (current month)
  vatDueCurrentMonth: number;

  // Revenue / expenses (current month)
  currentMonthRevenue: number;
  currentMonthExpenses: number;

  // Vendors
  recentVendors: string[]; // active in last 3 months (excl. current)
  activeThisMonth: string[]; // active this calendar month
}

async function gatherContext(userId: string): Promise<EngineContext> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  const firstOfMonth = new Date(currentYear, currentMonth - 1, 1);
  const threeMonthsAgo = new Date(currentYear, currentMonth - 4, 1); // start of month-3

  // ── Business entity ───────────────────────────────────────────────────────
  const [entity] = await db
    .select({ id: businessEntities.id })
    .from(businessEntities)
    .where(eq(businessEntities.ownerUserId, userId));

  const businessEntityId = entity?.id ?? null;
  const currency = "ILS";

  // ── Overdue collectible invoices (90+ days past due) ─────────────────────
  // Tax invoice-receipts and receipts are payment documents, not open debt.
  // Age is measured from the due date, falling back to the invoice date.
  const OPEN_STATUSES = ["issued", "sent"];
  let overdueCount = 0;
  let openInvoicesTotal = 0;
  let overdueTotal = 0;
  let overdueCurrency: string | null = null;
  const overdueInvoiceIds: string[] = [];

  if (businessEntityId) {
    const openRows = await db
      .select({
        id: outboundInvoices.id,
        total: outboundInvoices.total,
        currency: outboundInvoices.currency,
        daysOut: sql<number>`(current_date - coalesce(${outboundInvoices.dueDate}, ${outboundInvoices.invoiceDate})::date)::int`,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.businessEntityId, businessEntityId),
          eq(outboundInvoices.documentType, "TAX_INVOICE"),
          sql`${outboundInvoices.status} = ANY(ARRAY[${sql.raw(OPEN_STATUSES.map((s) => `'${s}'`).join(","))}]::text[])`,
          isNull(outboundInvoices.deletedAt),
        ),
      );

    for (const row of openRows) {
      const amount = Number(row.total ?? 0);
      openInvoicesTotal += amount;
      if (row.daysOut >= 90) {
        overdueCount++;
        overdueInvoiceIds.push(row.id);
        overdueTotal += amount;
        const cur = (row.currency ?? "ILS").toUpperCase();
        if (overdueCurrency && overdueCurrency !== cur) {
          overdueCurrency = "MIXED";
        } else if (!overdueCurrency) {
          overdueCurrency = cur;
        }
      }
    }
  }

  // ── Upcoming / overdue milestones ─────────────────────────────────────────
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const milestoneRows = await db
    .select({
      id: projectMilestones.id,
      title: projectMilestones.title,
      amount: projectMilestones.amount,
      dueDate: projectMilestones.dueDate,
      projectName: projects.name,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, userId),
        eq(projectMilestones.status, "pending"),
        lte(
          sql`${projectMilestones.dueDate}::date`,
          sql`${in7Days.toISOString().slice(0, 10)}::date`,
        ),
      ),
    )
    .orderBy(asc(projectMilestones.dueDate));

  const upcomingMilestones: EngineContext["upcomingMilestones"] = [];
  const overdueMilestoneIds: string[] = [];

  for (const m of milestoneRows) {
    const due = new Date(m.dueDate);
    const daysUntilDue = Math.ceil(
      (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    upcomingMilestones.push({
      id: m.id,
      title: m.title,
      amount: m.amount,
      daysUntilDue,
      projectName: m.projectName,
    });
    if (daysUntilDue < 0) overdueMilestoneIds.push(m.id);
  }

  // ── VAT position for current month ────────────────────────────────────────
  let vatDueCurrentMonth = 0;

  if (businessEntityId) {
    const [vatRow] = await db
      .select({
        vatCollected: sql<number>`coalesce(sum(
          case
            when ${outboundInvoices.documentType} in ('TAX_INVOICE','TAX_INVOICE_RECEIPT')
              then coalesce(${outboundInvoices.vatAmount}::numeric, 0)
            when ${outboundInvoices.documentType} = 'CREDIT_INVOICE'
              then -coalesce(${outboundInvoices.vatAmount}::numeric, 0)
            else 0
          end
        ), 0)::float`,
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.businessEntityId, businessEntityId),
          sql`extract(year from ${outboundInvoices.invoiceDate}) = ${currentYear}`,
          sql`extract(month from ${outboundInvoices.invoiceDate}) = ${currentMonth}`,
          sql`${outboundInvoices.status} != 'voided'`,
          isNull(outboundInvoices.deletedAt),
        ),
      );

    const [vatPaidRow] = await db
      .select({
        vatPaid: sql<number>`coalesce(sum(
          coalesce(${invoices.vatAmount}::numeric, 0) * coalesce(${invoices.vatCreditPercent}, 100) / 100.0
        ), 0)::float`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.userId, userId),
          gte(invoices.invoiceDate, firstOfMonth.toISOString().slice(0, 10)),
          lt(
            invoices.invoiceDate,
            new Date(currentYear, currentMonth, 1).toISOString().slice(0, 10),
          ),
        ),
      );

    vatDueCurrentMonth = (vatRow?.vatCollected ?? 0) - (vatPaidRow?.vatPaid ?? 0);
  }

  // ── Revenue / expenses current month ──────────────────────────────────────
  let currentMonthRevenue = 0;
  let currentMonthExpenses = 0;

  if (businessEntityId) {
    const [revRow] = await db
      .select({
        revenue: revenueSumExpr(
          sql`coalesce(${outboundInvoices.subtotal}::numeric, 0)`,
        ),
      })
      .from(outboundInvoices)
      .where(
        and(
          eq(outboundInvoices.businessEntityId, businessEntityId),
          sql`extract(year from ${outboundInvoices.invoiceDate}) = ${currentYear}`,
          sql`extract(month from ${outboundInvoices.invoiceDate}) = ${currentMonth}`,
          sql`${outboundInvoices.status} != 'voided'`,
          isNull(outboundInvoices.deletedAt),
        ),
      );
    currentMonthRevenue = revRow?.revenue ?? 0;

    const [expRow] = await db
      .select({
        expenses: sql<number>`coalesce(sum(
          coalesce(${invoices.amount}::numeric, 0)
        ), 0)::float`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.userId, userId),
          gte(invoices.invoiceDate, firstOfMonth.toISOString().slice(0, 10)),
          lt(
            invoices.invoiceDate,
            new Date(currentYear, currentMonth, 1).toISOString().slice(0, 10),
          ),
        ),
      );
    currentMonthExpenses = expRow?.expenses ?? 0;
  }

  // ── Vendor activity: last 3 months vs. this month ─────────────────────────
  const recentVendorRows = await db
    .select({ vendorName: invoices.suggestedVendorName })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        gte(invoices.invoiceDate, threeMonthsAgo.toISOString().slice(0, 10)),
        lt(invoices.invoiceDate, firstOfMonth.toISOString().slice(0, 10)),
        sql`${invoices.suggestedVendorName} IS NOT NULL`,
      ),
    )
    .orderBy(desc(invoices.invoiceDate));

  const thisMonthVendorRows = await db
    .select({ vendorName: invoices.suggestedVendorName })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        gte(invoices.invoiceDate, firstOfMonth.toISOString().slice(0, 10)),
        sql`${invoices.suggestedVendorName} IS NOT NULL`,
      ),
    );

  const recentVendors = [
    ...new Set(
      recentVendorRows
        .map((r) => r.vendorName)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const activeThisMonth = [
    ...new Set(
      thisMonthVendorRows
        .map((r) => r.vendorName)
        .filter((v): v is string => Boolean(v)),
    ),
  ];

  return {
    businessEntityId,
    currency,
    overdueCount,
    openInvoicesTotal,
    overdueTotal,
    overdueCurrency,
    overdueInvoiceIds,
    upcomingMilestones,
    overdueMilestoneIds,
    vatDueCurrentMonth,
    currentMonthRevenue,
    currentMonthExpenses,
    recentVendors,
    activeThisMonth,
  };
}

// ─── Rule-based checks ────────────────────────────────────────────────────────

function buildRuleBasedRecommendations(
  ctx: EngineContext,
): RawRecommendation[] {
  const recs: RawRecommendation[] = [];

  // overdue_invoice — 90+ days overdue
  if (ctx.overdueCount > 0) {
    const totalBit =
      ctx.overdueCurrency && ctx.overdueCurrency !== "MIXED"
        ? ` (total: ${ctx.overdueCurrency === "ILS" ? "₪" : ctx.overdueCurrency}${ctx.overdueTotal.toLocaleString("en-IL", { maximumFractionDigits: 0 })})`
        : "";
    recs.push({
      type: "overdue_invoice",
      priority: "urgent",
      title: `${ctx.overdueCount} invoice${ctx.overdueCount > 1 ? "s" : ""} 90+ days overdue`,
      body: `You have ${ctx.overdueCount} unpaid tax invoice${ctx.overdueCount > 1 ? "s" : ""} overdue by 90+ days${totalBit}. Follow up immediately.`,
      metadata: { invoiceIds: ctx.overdueInvoiceIds },
    });
  }

  // milestone_due — due within 7 days, still pending
  for (const ms of ctx.upcomingMilestones) {
    const label =
      ms.daysUntilDue < 0
        ? `overdue by ${Math.abs(ms.daysUntilDue)} day${Math.abs(ms.daysUntilDue) !== 1 ? "s" : ""}`
        : ms.daysUntilDue === 0
          ? "due today"
          : `due in ${ms.daysUntilDue} day${ms.daysUntilDue !== 1 ? "s" : ""}`;
    recs.push({
      type: "milestone_due",
      priority: ms.daysUntilDue < 0 ? "urgent" : "warning",
      title: `Milestone ${label}: ${ms.title}`,
      body: `Milestone "${ms.title}" (${ms.projectName}) is ${label}. Issue an invoice for ${ms.amount} ${ctx.currency} to get paid.`,
      metadata: { milestoneId: ms.id },
    });
  }

  // vat_refund — negative vatDue this month
  if (ctx.vatDueCurrentMonth < -100) {
    const refund = Math.abs(ctx.vatDueCurrentMonth);
    recs.push({
      type: "vat_refund",
      priority: "info",
      title: `VAT refund due this month: ~${Math.round(refund).toLocaleString("en-IL")} ${ctx.currency}`,
      body: `Your VAT input credits exceed collected VAT this month. You may be entitled to a refund of ~${Math.round(refund).toLocaleString("en-IL")} ${ctx.currency} from the tax authority.`,
      metadata: { vatDue: ctx.vatDueCurrentMonth },
    });
  }

  return recs;
}

// ─── AI-powered checks ────────────────────────────────────────────────────────

interface AiRecommendation {
  title: string;
  body: string;
  type: string;
  priority: string;
}

function buildAiContextPayload(ctx: EngineContext): string {
  const missingThisMonth = ctx.recentVendors.filter(
    (v) => !ctx.activeThisMonth.includes(v),
  );

  return JSON.stringify({
    currentMonth: {
      revenue: Math.round(ctx.currentMonthRevenue),
      expenses: Math.round(ctx.currentMonthExpenses),
      vatDue: Math.round(ctx.vatDueCurrentMonth),
    },
    openInvoicesTotal: Math.round(ctx.openInvoicesTotal),
    overdueCount: ctx.overdueCount,
    upcomingMilestones: ctx.upcomingMilestones.map((m) => ({
      title: m.title,
      daysUntilDue: m.daysUntilDue,
      amount: m.amount,
    })),
    recentVendors: ctx.recentVendors.slice(0, 20),
    missingThisMonth: missingThisMonth.slice(0, 10),
    currency: ctx.currency,
    preferredLocale: "en",
  });
}

async function runAiRecommendations(
  userId: string,
  ctx: EngineContext,
): Promise<RawRecommendation[]> {
  const { key: apiKey, source } = await resolveAnthropicApiKey(userId);
  if (!apiKey) {
    console.log(
      "[RecommendationEngine] No Anthropic key available for user %s — skipping AI recs",
      userId,
    );
    return [];
  }

  const client = new Anthropic({ apiKey });
  const userPayload = buildAiContextPayload(ctx);

  const response = await client.messages.create({
    model: RECOMMENDATION_MODEL,
    max_tokens: MAX_TOKENS,
    system: `You are a financial advisor assistant for Israeli small business owners and freelancers.
You analyze their business data and generate 3-5 short, actionable recommendations.

Rules:
- Always append this disclaimer to every body: "${DISCLAIMER}"
- Be specific: mention actual amounts and dates from the data
- Each recommendation must have: title (max 8 words), body (max 60 words including disclaimer), type, priority (info/warning/urgent)
- Respond ONLY with a valid JSON array, no markdown, no preamble:
  [{"title":"...","body":"...","type":"...","priority":"..."}]

Valid types: missing_expense | tax_bracket | weekly_digest | overdue_invoice | milestone_due | vat_refund

Focus areas:
- Missing recurring expenses (vendor seen in last 3 months but not this month)
- Tax bracket warnings (approaching next Israeli income-tax bracket threshold)
- Weekly financial digest (revenue this month, what goes to VAT/tax, what's yours)
- Cash flow patterns worth noting`,
    messages: [
      {
        role: "user",
        content: userPayload,
      },
    ],
  });

  const rawText =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  let parsed: AiRecommendation[] = [];
  try {
    // Strip any accidental markdown fences
    const json = rawText.replace(/^```[a-z]*\n?/m, "").replace(/```$/m, "").trim();
    parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) parsed = [];
  } catch (err) {
    console.warn(
      "[RecommendationEngine] Failed to parse AI response for user %s (source: %s): %s",
      userId,
      source,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  const validTypes = new Set<string>([
    "missing_expense",
    "tax_bracket",
    "weekly_digest",
    "overdue_invoice",
    "milestone_due",
    "vat_refund",
  ]);
  const validPriorities = new Set<string>(["info", "warning", "urgent"]);

  return parsed
    .filter(
      (r) =>
        r &&
        typeof r.title === "string" &&
        typeof r.body === "string" &&
        validTypes.has(r.type) &&
        validPriorities.has(r.priority),
    )
    .map((r) => ({
      type: r.type as RecommendationType,
      title: r.title.slice(0, 120),
      body: r.body.slice(0, 500),
      priority: r.priority as RecommendationPriority,
      isAiGenerated: true,
    }));
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate and persist fresh recommendations for a user.
 *
 * Runs rule-based checks unconditionally. Wraps all Anthropic calls in
 * try/catch so a failed AI call never prevents rule-based recs from being
 * saved. Safe to call concurrently for different users but do NOT call
 * multiple times for the same user concurrently.
 */
export async function generateRecommendations(userId: string): Promise<void> {
  // Verify the user exists before doing any work
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return;

  // 1. Gather context
  let ctx: EngineContext;
  try {
    ctx = await gatherContext(userId);
  } catch (err) {
    console.error(
      "[RecommendationEngine] Context gathering failed for user %s:",
      userId,
      err,
    );
    return;
  }

  // 2. Rule-based recommendations (always)
  const ruleRecs = buildRuleBasedRecommendations(ctx);
  if (ruleRecs.length > 0) {
    await insertRecommendations(userId, ruleRecs, false);
  }

  // 3. AI-powered recommendations (best-effort)
  try {
    const aiRecs = await runAiRecommendations(userId, ctx);
    if (aiRecs.length > 0) {
      await insertRecommendations(userId, aiRecs, true);
    }
  } catch (err) {
    console.error(
      "[RecommendationEngine] AI recommendation step failed for user %s:",
      userId,
      err instanceof Error ? err.message : String(err),
    );
    // Rule-based recs were already saved — swallow the AI error.
  }

  // 4. One live card per summary type. A cleared overdue condition
  //    dismisses the old urgent cards instead of leaving them up.
  if (!ruleRecs.some((r) => r.type === "overdue_invoice")) {
    await dismissAllOfType(userId, "overdue_invoice");
  }
  for (const type of SINGLETON_TYPES) {
    if (type === "overdue_invoice" && !ruleRecs.some((r) => r.type === type)) {
      continue;
    }
    await keepLatestOfType(userId, type);
  }
}
