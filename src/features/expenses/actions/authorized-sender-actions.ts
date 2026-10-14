"use server";

import crypto from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, ne, sql, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users, authorizedSenderEmails } from "@/db/schema";
import { auth } from "@/auth";
import { isValidEmailAddress } from "@/lib/email/address";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sendAuthorizedSenderVerificationEmail } from "@/lib/email/transactional";
import { getDictionary, getLocale } from "@/lib/i18n/server";

/** How many additional forwarding addresses a single account may register. */
const MAX_SENDERS = 5;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, mirrors email-verify / pwd-reset.

export interface AuthorizedSenderView {
  id: string;
  email: string;
  verified: boolean;
  createdAt: string;
}

async function requireUser(): Promise<{ id: string; email: string; name: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const row = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, email: true, name: true },
  });
  if (!row) throw new Error("Unauthorized");
  return row;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || h.get("x-real-ip")?.trim() || "unknown";
}

/** List the signed-in user's additional forwarding addresses. */
export async function listAuthorizedSendersAction(): Promise<AuthorizedSenderView[]> {
  const user = await requireUser();
  const rows = await db
    .select({
      id: authorizedSenderEmails.id,
      email: authorizedSenderEmails.email,
      verifiedAt: authorizedSenderEmails.verifiedAt,
      createdAt: authorizedSenderEmails.createdAt,
    })
    .from(authorizedSenderEmails)
    .where(eq(authorizedSenderEmails.ownerUserId, user.id));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    verified: r.verifiedAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function issueAndSend(params: {
  rowId: string;
  to: string;
  ownerName: string | null;
  ownerEmail: string;
  locale: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db
    .update(authorizedSenderEmails)
    .set({ token, expiresAt })
    .where(eq(authorizedSenderEmails.id, params.rowId));

  const sent = await sendAuthorizedSenderVerificationEmail({
    to: params.to,
    token,
    ownerName: params.ownerName,
    ownerEmail: params.ownerEmail,
    locale: params.locale,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true };
}

/**
 * Register an additional email as an authorised invoice sender for the
 * signed-in account and mail it a confirmation link. Rejects addresses that
 * belong to (or are already claimed by) another account. Idempotent for a
 * pending address on the same account — it just re-sends the link.
 */
export async function addAuthorizedSenderAction(
  rawEmail: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dict = await getDictionary();
  const user = await requireUser();
  const email = rawEmail.trim().toLowerCase();

  if (!isValidEmailAddress(email)) {
    return { ok: false, error: dict.errors.invalidEmailAddress };
  }
  if (email === user.email.toLowerCase()) {
    return {
      ok: false,
      error: dict.errors.senderIsAccountEmail,
    };
  }

  const ip = await clientIp();
  const ipLimit = await enforceRateLimit(`authsender:add:ip:${ip}`, 10, 60 * 60);
  const emailLimit = await enforceRateLimit(
    `authsender:add:email:${email}`,
    3,
    60 * 60,
  );
  if (!ipLimit.ok || !emailLimit.ok) {
    return { ok: false, error: dict.errors.tooManyAttempts };
  }

  // Belongs to another real account? The email is theirs, not the caller's.
  const otherUser = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, ne(users.id, user.id)))
    .limit(1);
  if (otherUser[0]) {
    return {
      ok: false,
      error: dict.errors.emailRegisteredElsewhere,
    };
  }

  // Already a VERIFIED sender somewhere (possibly this account).
  const verifiedElsewhere = await db
    .select({ ownerUserId: authorizedSenderEmails.ownerUserId })
    .from(authorizedSenderEmails)
    .where(
      and(
        sql`lower(${authorizedSenderEmails.email}) = ${email}`,
        isNotNull(authorizedSenderEmails.verifiedAt),
      ),
    )
    .limit(1);
  if (verifiedElsewhere[0]) {
    return {
      ok: false,
      error:
        verifiedElsewhere[0].ownerUserId === user.id
          ? "You've already added this address."
          : "That email is already linked to another account.",
    };
  }

  // Existing pending row for this owner+email → resend rather than duplicate.
  const existing = await db
    .select({ id: authorizedSenderEmails.id })
    .from(authorizedSenderEmails)
    .where(
      and(
        eq(authorizedSenderEmails.ownerUserId, user.id),
        sql`lower(${authorizedSenderEmails.email}) = ${email}`,
      ),
    )
    .limit(1);

  const locale = await getLocale();
  let rowId = existing[0]?.id;

  if (!rowId) {
    const count = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(authorizedSenderEmails)
      .where(eq(authorizedSenderEmails.ownerUserId, user.id))
      .then((r) => r[0]?.n ?? 0);
    if (count >= MAX_SENDERS) {
      return {
        ok: false,
        error: `You can add up to ${MAX_SENDERS} forwarding addresses.`,
      };
    }
    const inserted = await db
      .insert(authorizedSenderEmails)
      .values({ ownerUserId: user.id, email })
      .returning({ id: authorizedSenderEmails.id });
    rowId = inserted[0].id;
  }

  const result = await issueAndSend({
    rowId,
    to: email,
    ownerName: user.name,
    ownerEmail: user.email,
    locale,
  });
  if (!result.ok) {
    // Roll back a freshly-created row so the user can retry cleanly.
    if (!existing[0]) {
      await db
        .delete(authorizedSenderEmails)
        .where(eq(authorizedSenderEmails.id, rowId));
    }
    return result;
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Re-send the confirmation link for a pending address the caller owns. */
export async function resendAuthorizedSenderAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dict = await getDictionary();
  const user = await requireUser();
  const row = await db.query.authorizedSenderEmails.findFirst({
    where: and(
      eq(authorizedSenderEmails.id, id),
      eq(authorizedSenderEmails.ownerUserId, user.id),
    ),
  });
  if (!row) return { ok: false, error: dict.errors.addressNotFound };
  if (row.verifiedAt) return { ok: false, error: dict.errors.addressAlreadyVerified };

  const ip = await clientIp();
  const limit = await enforceRateLimit(
    `authsender:resend:email:${row.email}`,
    3,
    60 * 60,
  );
  const ipLimit = await enforceRateLimit(`authsender:resend:ip:${ip}`, 10, 60 * 60);
  if (!limit.ok || !ipLimit.ok) {
    return { ok: false, error: dict.errors.tooManyAttempts };
  }

  const locale = await getLocale();
  const result = await issueAndSend({
    rowId: row.id,
    to: row.email,
    ownerName: user.name,
    ownerEmail: user.email,
    locale,
  });
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** Remove an authorised sender (pending or verified) the caller owns. */
export async function removeAuthorizedSenderAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dict = await getDictionary();
  const user = await requireUser();
  const deleted = await db
    .delete(authorizedSenderEmails)
    .where(
      and(
        eq(authorizedSenderEmails.id, id),
        eq(authorizedSenderEmails.ownerUserId, user.id),
      ),
    )
    .returning({ id: authorizedSenderEmails.id });
  if (!deleted[0]) return { ok: false, error: dict.errors.addressNotFound };
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Consume a confirmation token from the emailed link. Public (the recipient
 * clicks it from their own mailbox and may not be signed in). Single-use with
 * a 1-hour expiry, matching the email-verification flow.
 */
export async function verifyAuthorizedSenderAction(params: {
  token: string;
  email: string;
}): Promise<{ success: true } | { error: string }> {
  const dict = await getDictionary();
  const token = params.token?.trim();
  const email = params.email?.trim().toLowerCase();
  if (!token || !email) {
    return { error: dict.errors.linkInvalidOrExpired };
  }

  const ip = await clientIp();
  const limit = await enforceRateLimit(`authsender:verify:ip:${ip}`, 20, 60 * 60);
  if (!limit.ok) return { error: dict.errors.tooManyAttempts };

  try {
    const row = await db.query.authorizedSenderEmails.findFirst({
      where: eq(authorizedSenderEmails.token, token),
    });
    if (
      !row ||
      row.verifiedAt ||
      !row.expiresAt ||
      row.expiresAt.getTime() < Date.now() ||
      row.email.toLowerCase() !== email
    ) {
      return { error: dict.errors.linkInvalidOrExpired };
    }

    await db
      .update(authorizedSenderEmails)
      .set({ verifiedAt: new Date(), token: null, expiresAt: null })
      .where(eq(authorizedSenderEmails.id, row.id));

    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    // Partial-unique-index violation (23505) = this address got verified on
    // another account between our check and write. Surface a clean message.
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : null;
    if (code === "23505") {
      return { error: dict.errors.emailLinkedElsewhere };
    }
    console.error("[verifyAuthorizedSenderAction] unexpected error:", err);
    return { error: dict.errors.somethingWentWrong };
  }
}
