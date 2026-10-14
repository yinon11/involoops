"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { users, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDictionary } from "@/lib/i18n/server";

/** For settings UI — whether to show the password card. */
export async function getAccountPasswordFlags(): Promise<{
  hasGoogleLinked: boolean;
  hasPassword: boolean;
} | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const google = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")),
    columns: { id: true },
  });

  return {
    hasPassword: Boolean(row?.passwordHash),
    hasGoogleLinked: Boolean(google),
  };
}

const updateSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
    currentPassword: z.string().optional(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * OAuth (Google) users may set an initial password or change an existing one.
 * Email/password signups always have a password and may change it here too.
 * Setting a password without a current one is only allowed when the user
 * has Google linked and has no password yet.
 */
export async function updateAccountPassword(formData: FormData) {
  const dict = await getDictionary();
  const session = await auth();
  if (!session?.user?.id) {
    return { error: dict.errors.mustBeSignedIn };
  }

  const userId = session.user.id;

  const parsed = updateSchema.safeParse({
    newPassword: (formData.get("newPassword") as string) ?? "",
    confirmPassword: (formData.get("confirmPassword") as string) ?? "",
    currentPassword: (formData.get("currentPassword") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { newPassword, confirmPassword, currentPassword } = parsed.data;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { passwordHash: true },
  });

  if (!user) {
    return { error: dict.errors.accountNotFound };
  }

  const hasPassword = Boolean(user.passwordHash);

  const googleLinked = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")),
    columns: { id: true },
  });

  if (hasPassword) {
    if (!currentPassword?.trim()) {
      return { error: dict.errors.enterCurrentPassword };
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash!);
    if (!ok) {
      return { error: dict.errors.currentPasswordIncorrect };
    }
  } else {
    if (!googleLinked) {
      return {
        error: dict.errors.cannotAddPasswordHere,
      };
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

  return { success: true as const };
}
