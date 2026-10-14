"use server";

import { db } from "@/db";
import { periods } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, or, sql } from "drizzle-orm";
import { getDictionary } from "@/lib/i18n/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    const dict = await getDictionary();
    throw new Error(dict.errors.unauthorized);
  }
  return session.user.id;
}

// ---------------------------------------------------------------------------
// getPeriods
// ---------------------------------------------------------------------------

export async function getPeriods() {
  const userId = await requireUserId();

  const rows = await db
    .select()
    .from(periods)
    .where(eq(periods.userId, userId))
    .orderBy(periods.year, periods.month);

  return rows;
}

// ---------------------------------------------------------------------------
// lockPeriod
// ---------------------------------------------------------------------------

export async function lockPeriod(year: number, month: number) {
  const userId = await requireUserId();

  // Upsert: insert or update
  const existing = await db.query.periods.findFirst({
    where: and(
      eq(periods.userId, userId),
      eq(periods.year, year),
      eq(periods.month, month)
    ),
  });

  if (existing) {
    await db
      .update(periods)
      .set({ isLocked: true, lockedAt: new Date() })
      .where(eq(periods.id, existing.id));
  } else {
    await db.insert(periods).values({
      userId,
      year,
      month,
      isLocked: true,
      lockedAt: new Date(),
    });
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// unlockPeriod
// ---------------------------------------------------------------------------

export async function unlockPeriod(year: number, month: number) {
  const userId = await requireUserId();
  const dict = await getDictionary();

  const existing = await db.query.periods.findFirst({
    where: and(
      eq(periods.userId, userId),
      eq(periods.year, year),
      eq(periods.month, month)
    ),
  });

  if (!existing) {
    throw new Error(dict.errors.periodNotFound);
  }

  await db
    .update(periods)
    .set({ isLocked: false, lockedAt: null })
    .where(eq(periods.id, existing.id));

  return { success: true };
}

// ---------------------------------------------------------------------------
// autoLockPastPeriods
// ---------------------------------------------------------------------------

export async function autoLockPastPeriods() {
  const userId = await requireUserId();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Find all unlocked periods that are before the current month
  const pastUnlocked = await db
    .select()
    .from(periods)
    .where(
      and(
        eq(periods.userId, userId),
        eq(periods.isLocked, false),
        or(
          sql`${periods.year} < ${currentYear}`,
          and(
            eq(periods.year, currentYear),
            sql`${periods.month} < ${currentMonth}`
          )
        )
      )
    );

  for (const period of pastUnlocked) {
    await db
      .update(periods)
      .set({ isLocked: true, lockedAt: new Date() })
      .where(eq(periods.id, period.id));
  }

  // Also create period records for months that don't have one yet.
  // Look at distinct addedMonth values from invoices to find relevant months.
  const { invoices } = await import("@/db/schema");

  const invoiceMonths = await db
    .selectDistinct({ addedMonth: invoices.addedMonth })
    .from(invoices)
    .where(eq(invoices.userId, userId));

  for (const row of invoiceMonths) {
    if (!row.addedMonth) continue;
    const [yearStr, monthStr] = row.addedMonth.split("-");
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);

    // Only lock past months
    if (y > currentYear || (y === currentYear && m >= currentMonth)) continue;

    const existing = await db.query.periods.findFirst({
      where: and(
        eq(periods.userId, userId),
        eq(periods.year, y),
        eq(periods.month, m)
      ),
    });

    if (!existing) {
      await db.insert(periods).values({
        userId,
        year: y,
        month: m,
        isLocked: true,
        lockedAt: new Date(),
      });
    }
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// isPeriodLocked
// ---------------------------------------------------------------------------

export async function isPeriodLocked(
  year: number,
  month: number
): Promise<boolean> {
  const userId = await requireUserId();

  const period = await db.query.periods.findFirst({
    where: and(
      eq(periods.userId, userId),
      eq(periods.year, year),
      eq(periods.month, month)
    ),
  });

  return period?.isLocked ?? false;
}
