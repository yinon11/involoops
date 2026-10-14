"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { featureInterestVotes } from "@/db/schema";
import { auth } from "@/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getTeaserConfig, type TeaserSlug } from "@/lib/teasers/config";
import { getDictionary } from "@/lib/i18n/server";

const IP_SALT =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "involoops-teaser";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(`${IP_SALT}:${ip}`).digest("hex");
}

export type CastVoteResult =
  | { ok: true; count: number; alreadyVoted: boolean }
  | { ok: false; error: string };

/**
 * Record a "I want this" interest vote for a teased feature. Idempotent —
 * the same user (or anonymous IP) can press the button repeatedly without
 * inflating the count, and we always return the current total.
 *
 * Logged-in voters are stored as `voter_key = "user:<uuid>"`; anonymous
 * voters as `voter_key = "ip:<sha256(salt + ip)>"`. We never persist a raw
 * IP. Rate-limited per IP to slow down scripted abuse.
 */
export async function castFeatureInterestVote(
  slug: string,
): Promise<CastVoteResult> {
  const dict = await getDictionary();
  const config = getTeaserConfig(slug as TeaserSlug);
  if (!config) {
    return { ok: false, error: dict.errors.unknownFeature };
  }

  const ip = await getClientIp();
  const limit = await enforceRateLimit(`teaser-vote:ip:${ip}`, 30, 60);
  if (!limit.ok) {
    return { ok: false, error: dict.errors.tooManyRequests };
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const voterKey = userId ? `user:${userId}` : `ip:${hashIp(ip)}`;

  const inserted = await db
    .insert(featureInterestVotes)
    .values({
      featureSlug: config.slug,
      userId,
      voterKey,
    })
    .onConflictDoNothing({
      target: [featureInterestVotes.featureSlug, featureInterestVotes.voterKey],
    })
    .returning({ id: featureInterestVotes.id });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(featureInterestVotes)
    .where(eq(featureInterestVotes.featureSlug, config.slug));

  if (config.revalidatePaths) {
    for (const path of config.revalidatePaths) {
      revalidatePath(path);
    }
  }

  return {
    ok: true,
    count: count ?? 0,
    alreadyVoted: inserted.length === 0,
  };
}

export interface FeatureInterestState {
  count: number;
  hasVoted: boolean;
}

/**
 * Read-only counterpart to `castFeatureInterestVote`. Returns the live
 * total plus whether the current viewer has already voted (so the UI can
 * render a filled state on first paint without an extra round-trip).
 */
export async function getFeatureInterestState(
  slug: string,
): Promise<FeatureInterestState> {
  const config = getTeaserConfig(slug as TeaserSlug);
  if (!config) {
    return { count: 0, hasVoted: false };
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Anonymous viewers: skip IP hashing on read, since we don't strictly need
  // the dedup signal client-side and it saves a header lookup on every
  // landing-page render. The vote action still enforces dedup on write.
  const voterKey = userId ? `user:${userId}` : null;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(featureInterestVotes)
    .where(eq(featureInterestVotes.featureSlug, config.slug));

  let hasVoted = false;
  if (voterKey) {
    const [existing] = await db
      .select({ id: featureInterestVotes.id })
      .from(featureInterestVotes)
      .where(
        and(
          eq(featureInterestVotes.featureSlug, config.slug),
          eq(featureInterestVotes.voterKey, voterKey),
        ),
      )
      .limit(1);
    hasVoted = Boolean(existing);
  }

  return { count: countRow?.count ?? 0, hasVoted };
}
