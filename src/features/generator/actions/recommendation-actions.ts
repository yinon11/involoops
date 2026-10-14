"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { recommendations } from "@/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateRecommendations } from "@/features/generator/lib/recommendation-engine";
import type { RecommendationPriority, RecommendationType } from "@/db/schema/recommendations";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

// ─── Return types ─────────────────────────────────────────────────────────────

export interface RecommendationItem {
  id: string;
  type: RecommendationType;
  title: string;
  body: string;
  priority: RecommendationPriority;
  readAt: Date | null;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

// Priority sort order: urgent → warning → info
const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  urgent: 0,
  warning: 1,
  info: 2,
};

// ─── getRecommendations ───────────────────────────────────────────────────────

/**
 * Fetch undismissed recommendations for the current user.
 * Ordered by priority (urgent first), then newest first. Limit 10.
 */
export async function getRecommendations(): Promise<RecommendationItem[]> {
  const userId = await requireUserId();

  const rows = await db
    .select({
      id: recommendations.id,
      type: recommendations.type,
      title: recommendations.title,
      body: recommendations.body,
      priority: recommendations.priority,
      readAt: recommendations.readAt,
      createdAt: recommendations.createdAt,
      metadata: recommendations.metadata,
    })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, userId),
        isNull(recommendations.dismissedAt),
      ),
    )
    .orderBy(desc(recommendations.createdAt))
    .limit(20); // fetch more than 10 so we can sort by priority client-side if needed

  // Sort by priority order, then newest first
  rows.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority as RecommendationPriority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority as RecommendationPriority] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return rows.slice(0, 10).map((r) => ({
    id: r.id,
    type: r.type as RecommendationType,
    title: r.title,
    body: r.body,
    priority: r.priority as RecommendationPriority,
    readAt: r.readAt,
    createdAt: r.createdAt,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }));
}

// ─── getUnreadCount ───────────────────────────────────────────────────────────

/** Returns the number of unread, undismissed recommendations. Used by the bell badge. */
export async function getUnreadRecommendationCount(): Promise<number> {
  const userId = await requireUserId();

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, userId),
        isNull(recommendations.dismissedAt),
        isNull(recommendations.readAt),
      ),
    );

  return row?.count ?? 0;
}

// ─── dismissRecommendation ────────────────────────────────────────────────────

export async function dismissRecommendation(id: string): Promise<void> {
  const userId = await requireUserId();

  await db
    .update(recommendations)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(recommendations.id, id),
        eq(recommendations.userId, userId),
      ),
    );

  revalidatePath("/money-in");
  revalidatePath("/");
}

// ─── markRecommendationRead ───────────────────────────────────────────────────

export async function markRecommendationRead(id: string): Promise<void> {
  const userId = await requireUserId();

  await db
    .update(recommendations)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(recommendations.id, id),
        eq(recommendations.userId, userId),
        isNull(recommendations.readAt),
      ),
    );
}

// ─── markAllRead ─────────────────────────────────────────────────────────────

export async function markAllRecommendationsRead(): Promise<void> {
  const userId = await requireUserId();

  await db
    .update(recommendations)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(recommendations.userId, userId),
        isNull(recommendations.dismissedAt),
        isNull(recommendations.readAt),
      ),
    );

  revalidatePath("/money-in");
}

// ─── triggerRecommendationRefresh ─────────────────────────────────────────────

/**
 * Manually trigger recommendation generation for the current user.
 * Called from the UI refresh button. Awaits completion (unlike fire-and-forget
 * paths) so the client sees fresh data after the call.
 */
export async function triggerRecommendationRefresh(): Promise<void> {
  const userId = await requireUserId();
  await generateRecommendations(userId);
  revalidatePath("/money-in");
}
