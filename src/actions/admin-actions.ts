"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import { isUserAdmin } from "@/lib/is-user-admin";
import { users } from "@/db/schema";
import { pricingTiers } from "@/db/schema/pricing-tiers";
import { userSubscriptions } from "@/db/schema/user-subscriptions";
import { assignFreePlan } from "@/lib/assign-free-plan";

const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
});

export async function adminCreateUser(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    return { error: "You do not have permission to add users." };
  }

  const raw = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const validated = createUserSchema.safeParse(raw);
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { email, password } = validated.data;

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return { error: "A user with this email already exists." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [newUser] = await db.insert(users).values({
    email,
    passwordHash,
  }).returning();

  // Auto-assign free tier subscription, email preferences, and fire signup event
  try {
    if (newUser) {
      await assignFreePlan(newUser.id);
    }
  } catch (err) {
    console.error("[AdminCreateUser] Post-creation setup error:", err);
  }

  revalidatePath("/dashboard");
  return { success: true as const };
}

/**
 * Get all users with their subscription and usage data for admin display.
 */
export async function getAdminUserList(): Promise<
  {
    id: string;
    email: string;
    name: string | null;
    isAdmin: boolean;
    createdAt: Date | null;
    tierName: string;
    tierCode: string;
    status: string;
    currentUsage: number;
    maxInvoices: number;
  }[]
> {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    return [];
  }

  const allUsers = await db.query.users.findMany();

  const result = [];
  for (const user of allUsers) {
    const sub = await db
      .select({
        tierName: pricingTiers.name,
        tierCode: pricingTiers.code,
        maxInvoices: pricingTiers.maxInvoicesPerMonth,
        status: userSubscriptions.status,
      })
      .from(userSubscriptions)
      .innerJoin(pricingTiers, eq(userSubscriptions.pricingTierId, pricingTiers.id))
      .where(eq(userSubscriptions.userId, user.id))
      .limit(1);

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [usageResult] = await db
      .select({ count: sql<number>`coalesce(invoice_count, 0)::int` })
      .from(sql`usage_tracking`)
      .where(
        sql`user_id = ${user.id} AND year_month = ${yearMonth}`,
      );

    const tier = sub[0];
    result.push({
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      tierName: tier?.tierName ?? "Free",
      tierCode: tier?.tierCode ?? "free",
      status: tier?.status ?? "free",
      currentUsage: usageResult?.count ?? 0,
      maxInvoices: tier?.maxInvoices ?? 10,
    });
  }

  return result;
}
