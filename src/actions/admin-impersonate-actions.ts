"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { auth, signIn } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";

const impersonateSchema = z.object({
  targetUserId: z.string().uuid("Invalid target user id"),
});

/**
 * Admin-only: sign in as another user. Reuses the `switch-account` Credentials
 * provider in `src/auth.ts`, which records the admin in the JWT `originator`
 * claim so the avatar dropdown can offer "Switch back".
 *
 * Defence in depth — admin status is re-checked here AND inside the provider's
 * `authorize()` from the DB. Never trust the cached JWT `isAdmin` claim alone.
 */
export async function impersonateUserAction(targetUserId: string) {
  const validated = impersonateSchema.safeParse({ targetUserId });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const session = await auth();
  const adminId = session?.user?.id;
  if (!adminId) {
    return { error: "Not signed in" };
  }
  // Don't allow chaining: an already-impersonated session must switch back first.
  if (session.user.originator) {
    return { error: "Switch back to your admin account first" };
  }
  if (adminId === validated.data.targetUserId) {
    return { error: "You are already this user" };
  }
  if (!(await isUserAdmin(adminId))) {
    return { error: "Admin access required" };
  }

  // Best-effort sanity check that the target exists. The provider re-reads it
  // anyway, so a race here is harmless.
  const target = await db.query.users.findFirst({
    where: eq(users.id, validated.data.targetUserId),
    columns: { id: true, email: true },
  });
  if (!target) {
    return { error: "User not found" };
  }

  try {
    await db.insert(auditLog).values({
      userId: adminId,
      action: "admin_impersonate_start",
      details: {
        targetUserId: target.id,
        targetEmail: target.email,
      },
    });
  } catch (err) {
    console.error("[admin-impersonate] audit log insert failed:", err);
  }

  try {
    await signIn("switch-account", {
      targetUserId: validated.data.targetUserId,
      redirectTo: "/money-out",
    });
  } catch (error) {
    // NextAuth throws NEXT_REDIRECT on success — rethrow so Next handles it.
    if (error instanceof AuthError) {
      return { error: "Impersonation refused by auth provider" };
    }
    throw error;
  }
}
