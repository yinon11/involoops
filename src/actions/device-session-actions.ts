"use server";

import { db } from "@/db";
import { deviceSessions } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireActorUserId } from "@/lib/team/enforce";

export interface DeviceSessionListItem {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export async function listDeviceSessions(): Promise<DeviceSessionListItem[]> {
  const userId = await requireActorUserId("manage_settings");
  const rows = await db
    .select({
      id: deviceSessions.id,
      deviceName: deviceSessions.deviceName,
      createdAt: deviceSessions.createdAt,
      lastUsedAt: deviceSessions.lastUsedAt,
      expiresAt: deviceSessions.expiresAt,
    })
    .from(deviceSessions)
    .where(and(eq(deviceSessions.userId, userId), isNull(deviceSessions.revokedAt)))
    .orderBy(desc(deviceSessions.createdAt));
  return rows.map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function revokeDeviceSession(id: string): Promise<{ ok: true }> {
  const userId = await requireActorUserId("manage_settings");
  await db
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceSessions.id, id),
        eq(deviceSessions.userId, userId),
        isNull(deviceSessions.revokedAt),
      ),
    );
  revalidatePath("/settings");
  return { ok: true };
}
