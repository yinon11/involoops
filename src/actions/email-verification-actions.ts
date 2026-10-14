"use server";

import { z } from "zod";
import crypto from "crypto";
import { headers } from "next/headers";
import { db } from "@/db";
import { users, emailVerificationTokens } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { sendEmailVerificationEmail } from "@/lib/email/transactional";
import { enforceRateLimit } from "@/lib/rate-limit";
import { auth } from "@/auth";
import { getDictionary, getLocale } from "@/lib/i18n/server";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Create a fresh verification token for a user, overwriting any prior token.
 * Sends the verification email. Returns { ok: true } on success so callers
 * can show a generic "check your inbox" message without leaking whether the
 * account exists.
 */
export async function issueEmailVerificationToken(userId: string) {
  const dict = await getDictionary();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return { ok: false as const, error: dict.errors.userNotFound };
  if (user.emailVerified) {
    return { ok: false as const, error: dict.errors.emailAlreadyVerified };
  }

  await db
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, user.id));

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(emailVerificationTokens).values({
    userId: user.id,
    token,
    expiresAt,
  });

  // New signups already have preferred_locale set by auth-actions; older
  // accounts may be NULL — fall back to the current request locale.
  const locale = user.preferredLocale ?? (await getLocale());
  const sent = await sendEmailVerificationEmail(
    user.email,
    user.name,
    token,
    locale,
    user.id,
  );
  if (!sent.ok) {
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, token));
    return { ok: false as const, error: sent.error };
  }

  return { ok: true as const };
}

const verifySchema = z.object({
  token: z.string().min(1, "Invalid link"),
  email: z.string().email("Invalid email address"),
});

/**
 * Consume a verification token: marks the user verified and deletes the
 * token row. Single-use and 1-hour expiry match the password-reset flow.
 */
export async function verifyEmailWithToken(params: {
  token: string;
  email: string;
}) {
  const dict = await getDictionary();
  const parsed = verifySchema.safeParse(params);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const { token } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  const ip = await getClientIp();
  const limit = await enforceRateLimit(`verify-email:${ip}`, 20, 60 * 60);
  if (!limit.ok) {
    return { error: dict.errors.tooManyAttempts };
  }

  try {
    const row = await db.query.emailVerificationTokens.findFirst({
      where: and(
        eq(emailVerificationTokens.token, token),
        gt(emailVerificationTokens.expiresAt, new Date()),
      ),
    });
    if (!row) {
      return {
        error: dict.errors.linkInvalidOrExpiredRequestNew,
      };
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, row.userId),
    });
    if (!user || user.email.toLowerCase() !== email) {
      return { error: dict.errors.linkInvalidOrExpiredRequestNew };
    }

    if (!user.emailVerified) {
      await db
        .update(users)
        .set({ emailVerified: new Date() })
        .where(eq(users.id, row.userId));
    }

    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, row.userId));

    return { success: true as const };
  } catch {
    return { error: dict.errors.somethingWentWrong };
  }
}

const resendSchema = z.object({
  email: z.string().email("Invalid email address"),
});

/** Generic message — never leak whether the account exists / is verified. */
const GENERIC_RESEND_MSG =
  "If your account needs verification, we've sent a new link. Check your inbox.";

/**
 * Resend a verification email. Works for:
 *  - an authenticated unverified user (banner "resend" button), OR
 *  - an unauthenticated caller supplying an email (login-page nudge).
 * Always returns a generic success message on the public path to avoid
 * account-enumeration.
 */
export async function resendVerificationEmail(formData: FormData) {
  const dict = await getDictionary();
  const raw = { email: (formData.get("email") as string) ?? "" };
  const parsed = resendSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const email = parsed.data.email.toLowerCase().trim();

  const session = await auth();
  const sessionEmail = session?.user?.email?.toLowerCase() ?? null;
  const isSelfServe = sessionEmail === email;

  const ip = await getClientIp();
  const ipLimit = await enforceRateLimit(`verify-resend:ip:${ip}`, 10, 60 * 60);
  const emailLimit = await enforceRateLimit(
    `verify-resend:email:${email}`,
    3,
    60 * 60,
  );
  if (!ipLimit.ok || !emailLimit.ok) {
    return { success: true as const, message: GENERIC_RESEND_MSG };
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!user || user.emailVerified) {
      return { success: true as const, message: GENERIC_RESEND_MSG };
    }

    const result = await issueEmailVerificationToken(user.id);
    if (!result.ok && isSelfServe) {
      return { error: result.error };
    }
    return { success: true as const, message: GENERIC_RESEND_MSG };
  } catch {
    return { error: dict.errors.somethingWentWrong };
  }
}
