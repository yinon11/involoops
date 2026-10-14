"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateApiKey } from "@/lib/api/key-format";
import { isScope, type Scope } from "@/lib/api/scopes";
import type { ActionResultWith } from "@/types/action-result";
import { getDictionary } from "@/lib/i18n/server";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  mode: "live" | "test";
  scopes: Scope[];
  publicId: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export async function listApiKeys(): Promise<ApiKeyListItem[]> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode as "live" | "test",
    scopes: r.scopes as Scope[],
    publicId: r.publicId,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }));
}

export interface CreateApiKeyInput {
  name: string;
  mode: "live" | "test";
  scopes: string[];
  expiresInDays?: number | null;
}

export interface CreateApiKeyResult {
  /** Plaintext token — show ONCE then discard. */
  token: string;
  key: ApiKeyListItem;
}

export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<ActionResultWith<CreateApiKeyResult>> {
  const dict = await getDictionary();
  const userId = await requireUserId();

  const name = input.name?.trim();
  if (!name || name.length > 120) {
    return {
      success: false,
      error: dict.errors.apiKeyNameRequired,
    };
  }
  if (input.mode !== "live" && input.mode !== "test") {
    return { success: false, error: dict.errors.apiKeyModeInvalid };
  }
  const scopes: Scope[] = [];
  for (const s of input.scopes ?? []) {
    if (isScope(s) && !scopes.includes(s)) scopes.push(s);
  }
  if (scopes.length === 0) {
    return { success: false, error: dict.errors.apiKeyScopeRequired };
  }

  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const generated = generateApiKey(input.mode);

  const [row] = await db
    .insert(apiKeys)
    .values({
      userId,
      name,
      publicId: generated.publicId,
      secretHash: generated.secretHash,
      mode: input.mode,
      scopes,
      expiresAt,
    })
    .returning();

  revalidatePath("/settings/api-keys");

  return {
    success: true,
    token: generated.token,
    key: {
      id: row.id,
      name: row.name,
      mode: row.mode as "live" | "test",
      scopes: row.scopes as Scope[],
      publicId: row.publicId,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      revokedAt: null,
    },
  };
}

export async function revokeApiKey(
  id: string,
  reason?: string,
): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(apiKeys)
    .set({
      revokedAt: new Date(),
      revokedReason: reason?.slice(0, 255) ?? "user-revoked",
    })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt),
      ),
    );
  revalidatePath("/settings/api-keys");
}
