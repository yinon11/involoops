"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getUserApiKeyStatus,
  isUserApiKeyStorageConfigured,
  removeUserApiKey,
  saveUserApiKey,
  type ApiKeyStatus,
  type SaveKeyErrorCode,
} from "@/lib/user-api-key";
import { onFunnelEvent } from "@/lib/email/funnel-event-service";
import { FunnelEvents } from "@/lib/email/funnel-constants";
import { sendUserSetOwnKeyNotification } from "@/lib/email/transactional";
import { db } from "@/db";
import { users } from "@/db/schema/users";
import { eq } from "drizzle-orm";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

/**
 * Returned by the "get status" action. Deliberately excludes anything that
 * could be used to reconstruct the key — just whether one exists, its hint,
 * and when it was last validated.
 */
export interface UserApiKeyStatus extends ApiKeyStatus {
  /** True when the server can accept a new key (encryption secret present). */
  storageConfigured: boolean;
}

export async function getUserApiKeyStatusAction(): Promise<UserApiKeyStatus> {
  const userId = await requireUserId();
  const status = await getUserApiKeyStatus(userId);
  return {
    ...status,
    storageConfigured: isUserApiKeyStorageConfigured(),
  };
}

/**
 * Zod-validated key input. We don't try to match Anthropic's exact format
 * here — the server-side `saveUserApiKey` does a stricter regex check AND
 * probes the key against Anthropic before accepting it. This schema just
 * catches obviously-wrong payloads (empty string, non-string, absurd
 * length).
 */
const apiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "API key looks too short.")
    .max(256, "API key looks too long."),
});

/**
 * Discriminated result returned to the BYOK card. On failure, `code` is
 * stable and the client uses it to look up a translated message; `model`
 * is set when `code === "model_access"` so the message can name which
 * model the user's tier is missing.
 */
export type SetUserApiKeyResult =
  | { ok: true; hint: string }
  | {
      ok: false;
      /** English fallback — use the dictionary keyed by `code` when possible. */
      error: string;
      code: SaveKeyErrorCode;
      model?: string;
    };

export async function setUserApiKeyAction(
  rawKey: string
): Promise<SetUserApiKeyResult> {
  const userId = await requireUserId();

  const parsed = apiKeySchema.safeParse({ apiKey: rawKey });
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_format",
      error: parsed.error.issues[0]?.message ?? "Invalid API key.",
    };
  }

  const result = await saveUserApiKey(userId, parsed.data.apiKey);
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      error: result.error,
      ...(result.model ? { model: result.model } : {}),
    };
  }

  // The settings page & plan-usage card reflect the new BYOK tier.
  revalidatePath("/settings");

  // Exits conversion funnels (approaching / limit-reached) since the user
  // resolved their usage ceiling by supplying their own key. Wrapped
  // because funnel infra must never block the settings flow.
  try {
    await onFunnelEvent(userId, FunnelEvents.USER_SET_OWN_KEYS);
  } catch (err) {
    console.error("[user-api-key] USER_SET_OWN_KEYS event failed:", err);
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true, email: true },
    });
    await sendUserSetOwnKeyNotification({
      name: user?.name ?? null,
      email: user?.email ?? null,
      hint: result.hint ?? null,
    });
  } catch (err) {
    console.error("[user-api-key] admin notification failed:", err);
  }

  return { ok: true, hint: result.hint ?? "" };
}

export async function removeUserApiKeyAction(): Promise<{ ok: true }> {
  const userId = await requireUserId();
  await removeUserApiKey(userId);
  revalidatePath("/settings");
  try {
    await onFunnelEvent(userId, FunnelEvents.USER_REMOVED_OWN_KEYS);
  } catch (err) {
    console.error("[user-api-key] USER_REMOVED_OWN_KEYS event failed:", err);
  }
  return { ok: true };
}
