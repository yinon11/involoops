"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { isUserAdmin } from "@/lib/is-user-admin";
import {
  users,
  invoices,
  vendors,
  usageTracking,
  userSubscriptions,
  pricingTiers,
} from "@/db/schema";
import { desc, eq, gte, sql } from "drizzle-orm";
import { BYOK_MONTHLY_INVOICE_CAP } from "@/lib/effective-tier";

export interface AdminAnalyticsUserRow {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  isAdmin: boolean;
  /** ISO timestamp. Postgres-js + drizzle `sql` tag returns timestamps as
   * strings; keeping the wire format uniform avoids Date / string branching
   * on the client. */
  createdAt: string | null;
  tierName: string;
  tierCode: string;
  maxInvoicesPerMonth: number;
  currentMonthUsage: number;
  totalInvoices: number;
  approvedInvoices: number;
  pendingInvoices: number;
  rejectedInvoices: number;
  vendorCount: number;
  totalLlmCostUsd: number;
  lastActivityAt: string | null;
  /** True when the user has a stored, validated Anthropic API key (BYOK).
   * BYOK users are billed nothing by us and effectively run on the
   * Enterprise tier — `tierCode`/`tierName` still reflect their stored
   * subscription, so the admin can see both. */
  hasUserApiKey: boolean;
  /** Last 4 chars of the user's Anthropic key (e.g. "...A1B2") if set. */
  apiKeyHint: string | null;
}

export interface AdminAnalyticsOverview {
  totalUsers: number;
  adminUsers: number;
  totalInvoices: number;
  invoicesThisMonth: number;
  newUsersThisMonth: number;
  activeUsers7d: number;
  activeUsers30d: number;
  totalLlmCostUsd: number;
}

export interface AdminAnalyticsData {
  overview: AdminAnalyticsOverview;
  users: AdminAnalyticsUserRow[];
  topUsersByInvoices: Array<{
    id: string;
    email: string;
    name: string | null;
    totalInvoices: number;
  }>;
  topUsersThisMonth: Array<{
    id: string;
    email: string;
    name: string | null;
    currentMonthUsage: number;
  }>;
  recentlyActiveUsers: Array<{
    id: string;
    email: string;
    name: string | null;
    lastActivityAt: string | null;
  }>;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Normalize a value that might be a Date (drizzle schema column) or a string
 * (drizzle `sql` tag result) into an ISO string. */
function toIsoOrNull(v: Date | string | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  // Already a string — trust the driver output. Falls through for ISO strings
  // and postgres textual timestamps alike.
  return v;
}

function timestampMs(v: string | null): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Aggregate usage analytics across every user. Admin-only. Returns null when the
 * caller is not an admin so the page can render a 404.
 */
export async function getAdminUserAnalytics(): Promise<AdminAnalyticsData | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!(await isUserAdmin(session.user.id))) return null;

  const yearMonth = currentYearMonth();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // postgres-js cannot bind raw JS Date objects as `$N` parameters inside a
  // drizzle `sql\`…\`` template — it throws `ERR_INVALID_ARG_TYPE`. Drizzle's
  // operator builders (`gte`, `eq`, …) know the column type and handle the
  // conversion, but for raw sql we have to pass an ISO string ourselves.
  const startOfMonthIso = startOfMonth.toISOString();

  // Per-user invoice aggregates (all time).
  const invoiceAggregates = await db
    .select({
      userId: invoices.userId,
      totalInvoices: sql<number>`count(*)::int`,
      approvedInvoices: sql<number>`count(*) filter (where ${invoices.status} = 'approved')::int`,
      pendingInvoices: sql<number>`count(*) filter (where ${invoices.status} = 'pending' or ${invoices.status} = 'processing')::int`,
      rejectedInvoices: sql<number>`count(*) filter (where ${invoices.status} = 'rejected')::int`,
      totalLlmCostUsd: sql<string>`coalesce(sum(${invoices.llmCostUsd}), 0)::text`,
      lastActivityAt: sql<string | null>`max(${invoices.updatedAt})`,
    })
    .from(invoices)
    .groupBy(invoices.userId);

  const invoiceAggMap = new Map<string, (typeof invoiceAggregates)[number]>();
  for (const row of invoiceAggregates) {
    invoiceAggMap.set(row.userId, row);
  }

  // Per-user vendor counts.
  const vendorAggregates = await db
    .select({
      userId: vendors.userId,
      vendorCount: sql<number>`count(*)::int`,
    })
    .from(vendors)
    .groupBy(vendors.userId);

  const vendorAggMap = new Map<string, number>();
  for (const row of vendorAggregates) {
    vendorAggMap.set(row.userId, row.vendorCount);
  }

  // Current-month usage from the usage_tracking table.
  const usageRows = await db
    .select({
      userId: usageTracking.userId,
      invoiceCount: usageTracking.invoiceCount,
    })
    .from(usageTracking)
    .where(eq(usageTracking.yearMonth, yearMonth));

  const usageMap = new Map<string, number>();
  for (const row of usageRows) {
    usageMap.set(row.userId, row.invoiceCount);
  }

  // Every user with their active subscription/tier. LEFT JOIN so free users without
  // a user_subscriptions row still appear.
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      companyName: users.companyName,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      tierName: pricingTiers.name,
      tierCode: pricingTiers.code,
      maxInvoicesPerMonth: pricingTiers.maxInvoicesPerMonth,
      anthropicApiKeyCiphertext: users.anthropicApiKeyCiphertext,
      anthropicApiKeyValidatedAt: users.anthropicApiKeyValidatedAt,
      anthropicApiKeyHint: users.anthropicApiKeyHint,
    })
    .from(users)
    .leftJoin(userSubscriptions, eq(userSubscriptions.userId, users.id))
    .leftJoin(pricingTiers, eq(userSubscriptions.pricingTierId, pricingTiers.id))
    .orderBy(desc(users.createdAt));

  // Effective monthly cap for BYOK users — mirrors `getByokTier()` in
  // `src/lib/effective-tier.ts`. The admin table previously displayed the
  // user's STORED tier limit (free → 10) for BYOK users, so a BYOK user
  // who legitimately uploaded 25 invoices showed up as "25/10" in red,
  // even though enforcement was correctly using the BYOK cap of 500.
  // Re-derive the effective cap here so the column matches what the
  // upload pipeline actually allows. Single-shot lookup outside the
  // per-user loop to keep this O(1) extra query.
  const enterpriseTier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.code, "enterprise"),
  });
  const byokMaxInvoices = Math.min(
    enterpriseTier?.maxInvoicesPerMonth ?? BYOK_MONTHLY_INVOICE_CAP,
    BYOK_MONTHLY_INVOICE_CAP,
  );

  const rows: AdminAnalyticsUserRow[] = userRows.map((u) => {
    const agg = invoiceAggMap.get(u.id);
    // Mirror the BYOK check from `isUserByok` — ciphertext + validated_at
    // are sufficient indicators here (we don't need iv/tag to know the key
    // is set and verified). Tier resolution still re-checks all four parts
    // server-side on every request, so this is purely a UI signal.
    const hasUserApiKey =
      !!u.anthropicApiKeyCiphertext && !!u.anthropicApiKeyValidatedAt;
    // BYOK users get the Enterprise-equivalent cap regardless of their
    // stored Stripe tier — that's what `resolveEffectiveTier` returns at
    // runtime, so the admin display has to agree to avoid the false
    // "over quota" colouring on perfectly healthy BYOK accounts.
    // Tier name/code are intentionally NOT overridden: the separate BYOK
    // badge already conveys "Enterprise-equivalent", and admins still
    // need to see the underlying Stripe tier (e.g. "free + BYOK" vs
    // "pro + BYOK") for billing diagnostics.
    const maxInvoicesPerMonth = hasUserApiKey
      ? byokMaxInvoices
      : u.maxInvoicesPerMonth ?? 10;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      companyName: u.companyName,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt ? toIsoOrNull(u.createdAt) : null,
      tierName: u.tierName ?? "Free",
      tierCode: u.tierCode ?? "free",
      maxInvoicesPerMonth,
      currentMonthUsage: usageMap.get(u.id) ?? 0,
      totalInvoices: agg?.totalInvoices ?? 0,
      approvedInvoices: agg?.approvedInvoices ?? 0,
      pendingInvoices: agg?.pendingInvoices ?? 0,
      rejectedInvoices: agg?.rejectedInvoices ?? 0,
      vendorCount: vendorAggMap.get(u.id) ?? 0,
      totalLlmCostUsd: agg?.totalLlmCostUsd ? Number(agg.totalLlmCostUsd) : 0,
      lastActivityAt: toIsoOrNull(agg?.lastActivityAt ?? null),
      hasUserApiKey,
      apiKeyHint: hasUserApiKey ? u.anthropicApiKeyHint ?? null : null,
    };
  });

  // Overview stats.
  const [{ totalUsers, adminUsers, newUsersThisMonth }] = await db
    .select({
      totalUsers: sql<number>`count(*)::int`,
      adminUsers: sql<number>`count(*) filter (where ${users.isAdmin} = true)::int`,
      newUsersThisMonth: sql<number>`count(*) filter (where ${users.createdAt} >= ${startOfMonthIso})::int`,
    })
    .from(users);

  const [invoiceOverview] = await db
    .select({
      totalInvoices: sql<number>`count(*)::int`,
      invoicesThisMonth: sql<number>`count(*) filter (where ${invoices.createdAt} >= ${startOfMonthIso})::int`,
      totalLlmCostUsd: sql<string>`coalesce(sum(${invoices.llmCostUsd}), 0)::text`,
    })
    .from(invoices);

  const [{ activeUsers7d }] = await db
    .select({
      activeUsers7d: sql<number>`count(distinct ${invoices.userId})::int`,
    })
    .from(invoices)
    .where(gte(invoices.updatedAt, sevenDaysAgo));

  const [{ activeUsers30d }] = await db
    .select({
      activeUsers30d: sql<number>`count(distinct ${invoices.userId})::int`,
    })
    .from(invoices)
    .where(gte(invoices.updatedAt, thirtyDaysAgo));

  const overview: AdminAnalyticsOverview = {
    totalUsers,
    adminUsers,
    newUsersThisMonth,
    totalInvoices: invoiceOverview?.totalInvoices ?? 0,
    invoicesThisMonth: invoiceOverview?.invoicesThisMonth ?? 0,
    activeUsers7d,
    activeUsers30d,
    totalLlmCostUsd: invoiceOverview?.totalLlmCostUsd
      ? Number(invoiceOverview.totalLlmCostUsd)
      : 0,
  };

  const topUsersByInvoices = [...rows]
    .sort((a, b) => b.totalInvoices - a.totalInvoices)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      totalInvoices: r.totalInvoices,
    }));

  const topUsersThisMonth = [...rows]
    .sort((a, b) => b.currentMonthUsage - a.currentMonthUsage)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      currentMonthUsage: r.currentMonthUsage,
    }));

  const recentlyActiveUsers = [...rows]
    .filter((r) => r.lastActivityAt != null)
    .sort((a, b) => timestampMs(b.lastActivityAt) - timestampMs(a.lastActivityAt))
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      lastActivityAt: r.lastActivityAt,
    }));

  return {
    overview,
    users: rows,
    topUsersByInvoices,
    topUsersThisMonth,
    recentlyActiveUsers,
  };
}
