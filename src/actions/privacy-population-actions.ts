"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { privacyPopulationSnapshots, users } from "@/db/schema";
import { isUserAdmin } from "@/lib/is-user-admin";
import { countPopulation } from "@/lib/privacy/population";

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return (await isUserAdmin(session.user.id)) ? session.user.id : null;
}

export interface PopulationSnapshotRow {
  id: string;
  takenAt: string;
  takenBy: string | null;
  totalPeople: number;
  breakdown: Record<string, number>;
  note: string | null;
}

export async function getPopulationSnapshots(): Promise<PopulationSnapshotRow[]> {
  if (!(await requireAdmin())) return [];
  const rows = await db
    .select({
      id: privacyPopulationSnapshots.id,
      takenAt: privacyPopulationSnapshots.takenAt,
      takenBy: users.email,
      totalPeople: privacyPopulationSnapshots.totalPeople,
      breakdown: privacyPopulationSnapshots.breakdown,
      note: privacyPopulationSnapshots.note,
    })
    .from(privacyPopulationSnapshots)
    .leftJoin(users, eq(users.id, privacyPopulationSnapshots.takenByUserId))
    .orderBy(desc(privacyPopulationSnapshots.takenAt))
    .limit(50);
  return rows.map((r) => ({ ...r, takenAt: r.takenAt.toISOString() }));
}

const noteSchema = z.string().trim().max(500).optional();

/** Recount now and store the result as the new baseline. */
export async function recordPopulationSnapshot(
  note?: string,
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, error: "Unauthorized" };
  const parsed = noteSchema.safeParse(note);
  if (!parsed.success) return { ok: false, error: "Note is too long" };

  const count = await countPopulation();
  await db.insert(privacyPopulationSnapshots).values({
    takenByUserId: adminId,
    totalPeople: count.total,
    breakdown: {
      ...count.bySource,
      companyNumberedCustomers: count.companyNumberedCustomers,
    },
    note: parsed.data || null,
  });
  revalidatePath("/admin/privacy-population");
  return { ok: true, total: count.total };
}
