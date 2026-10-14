"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { headers } from "next/headers";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { sendPasswordResetEmail } from "@/lib/email/transactional";
import { enforceRateLimit } from "@/lib/rate-limit";
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

const emailSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetSchema = z
  .object({
    token: z.string().min(1, "Invalid link"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/** Generic message — do not reveal whether the email exists. */
/**
 * Both generic messages live in the dictionary and are read per-request: they
 * are user-facing, so they have to follow the active locale, and a
 * module-level const cannot await `getDictionary()`.
 *
 * `somethingWentWrongLater` is shown when SES/config fails; the real error is
 * server-logged only (never expose AWS messages).
 */

export async function requestPasswordReset(formData: FormData) {
  const dict = await getDictionary();
  const raw = { email: (formData.get("email") as string) ?? "" };
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const email = parsed.data.email.toLowerCase().trim();
  console.info("[password-reset] request", { email });

  // Cap reset requests so an attacker can't (a) enumerate accounts by timing
  // or (b) spam a victim's inbox with reset emails. The message stays generic
  // either way, so we return the same success-shaped response on throttle.
  const ip = await getClientIp();
  const ipLimit = await enforceRateLimit(`reset:ip:${ip}`, 10, 60 * 60);
  const emailLimit = await enforceRateLimit(
    `reset:email:${email}`,
    3,
    60 * 60,
  );
  if (!ipLimit.ok || !emailLimit.ok) {
    console.warn("[password-reset] rate limited", {
      ipOk: ipLimit.ok,
      ipRetryAfterSec: ipLimit.retryAfter,
      emailOk: emailLimit.ok,
      emailRetryAfterSec: emailLimit.retryAfter,
    });
    return { success: true, message: dict.errors.resetLinkSentGeneric };
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      console.info(
        "[password-reset] no user for email — returning generic success (no email sent)",
      );
      return { success: true, message: dict.errors.resetLinkSentGeneric };
    }

    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token,
      expiresAt,
    });

    // Prefer the user's stored preference; fall back to the current request
    // locale so visitors on a Hebrew page get a Hebrew reset email even if
    // their account predates `preferred_locale`.
    const locale = user.preferredLocale ?? (await getLocale());
    const sent = await sendPasswordResetEmail(
      user.email,
      token,
      locale,
      user.id,
    );
    if (!sent.ok) {
      console.error("[password-reset] SES rejected send:", sent.error);
      await db
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.token, token));
      return { error: dict.errors.somethingWentWrongLater };
    }

    console.info("[password-reset] reset email sent via SES", {
      to: user.email,
    });
    return { success: true, message: dict.errors.resetLinkSentGeneric };
  } catch (err) {
    console.error("[password-reset] unexpected error:", err);
    return { error: dict.errors.somethingWentWrongLater };
  }
}

export async function resetPasswordWithToken(formData: FormData) {
  const dict = await getDictionary();
  const raw = {
    token: (formData.get("token") as string) ?? "",
    password: (formData.get("password") as string) ?? "",
    confirmPassword: (formData.get("confirmPassword") as string) ?? "",
  };

  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { token, password } = parsed.data;

  try {
    const row = await db.query.passwordResetTokens.findFirst({
      where: and(
        eq(passwordResetTokens.token, token),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    });

    if (!row) {
      return { error: dict.errors.linkInvalidOrExpiredRequestNew };
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, row.userId));

    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, row.userId));

    return { success: true };
  } catch {
    return { error: dict.errors.somethingWentWrong };
  }
}
