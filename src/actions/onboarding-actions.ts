"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

interface OnboardingStepPayload {
  name?: string;
  businessType?: "freelancer" | "small_business";
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

/**
 * Persist progress through the onboarding wizard (the user's name and
 * business_type live on `users`).
 */
export async function saveOnboardingStep(
  step: number,
  data: OnboardingStepPayload,
): Promise<void> {
  const userId = await requireUserId();

  const update: Partial<typeof users.$inferInsert> = {
    onboardingStep: step,
  };
  if (data.name && data.name.trim()) update.name = data.name.trim();
  if (data.businessType) update.businessType = data.businessType;

  await db.update(users).set(update).where(eq(users.id, userId));
}

export async function completeOnboarding(): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(users)
    .set({ onboardingCompleted: true, onboardingStep: 99 })
    .where(eq(users.id, userId));
  revalidatePath("/");
}
