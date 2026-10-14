"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { webhookEndpoints, type WebhookEndpointRow } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  generateWebhookSecret,
  isWebhookSecretStorageConfigured,
} from "@/lib/webhooks/signing";
import { parseWebhookUrl } from "@/lib/webhooks/ssrf";
import {
  EVENT_TYPES,
  isEventType,
  type EventType,
} from "@/lib/webhooks/events";
import type { ActionResultWith } from "@/types/action-result";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export interface WebhookEndpointListItem {
  id: string;
  url: string;
  description: string | null;
  events: EventType[];
  active: boolean;
  secretHint: string;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
}

function serialize(row: WebhookEndpointRow): WebhookEndpointListItem {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events as EventType[],
    active: row.active,
    secretHint: row.secretHint,
    createdAt: row.createdAt.toISOString(),
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    consecutiveFailures: row.consecutiveFailures,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    disabledReason: row.disabledReason,
  };
}

export async function listWebhookEndpoints(): Promise<WebhookEndpointListItem[]> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.userId, userId))
    .orderBy(desc(webhookEndpoints.createdAt));
  return rows.map(serialize);
}

export interface CreateWebhookEndpointInput {
  url: string;
  description?: string | null;
  events: string[];
}

export interface CreateWebhookEndpointResult {
  /** Plaintext signing secret — show ONCE then discard. */
  secret: string;
  endpoint: WebhookEndpointListItem;
}

export async function createWebhookEndpoint(
  input: CreateWebhookEndpointInput,
): Promise<ActionResultWith<CreateWebhookEndpointResult>> {
  const userId = await requireUserId();
  if (!isWebhookSecretStorageConfigured()) {
    return {
      success: false,
      error:
        "Webhook storage is not configured. Set WEBHOOK_SECRET_ENCRYPTION_SECRET or AUTH_SECRET.",
    };
  }

  // Sync URL parse so we surface the validation error at the UI layer.
  // (Deep check-against-DNS happens at every delivery too.)
  try {
    parseWebhookUrl(input.url);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Invalid URL",
    };
  }

  const events: EventType[] = [];
  for (const e of input.events ?? []) {
    if (isEventType(e) && !events.includes(e)) events.push(e);
  }
  if (events.length === 0) {
    return {
      success: false,
      error: `At least one event is required. Valid events: ${EVENT_TYPES.join(", ")}.`,
    };
  }

  const { token, hint, encrypted } = generateWebhookSecret();

  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      userId,
      url: input.url,
      description: input.description?.slice(0, 500) ?? null,
      events,
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
      secretHint: hint,
    })
    .returning();

  revalidatePath("/settings/webhooks");

  return { success: true, secret: token, endpoint: serialize(row) };
}

export async function deleteWebhookEndpoint(id: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)));
  revalidatePath("/settings/webhooks");
}

export async function rotateWebhookSecret(
  id: string,
): Promise<{ secret: string; endpoint: WebhookEndpointListItem }> {
  const userId = await requireUserId();
  const { token, hint, encrypted } = generateWebhookSecret();
  const [row] = await db
    .update(webhookEndpoints)
    .set({
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
      secretHint: hint,
    })
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)))
    .returning();
  if (!row) throw new Error("Endpoint not found");
  revalidatePath("/settings/webhooks");
  return { secret: token, endpoint: serialize(row) };
}

export async function reactivateWebhookEndpoint(id: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(webhookEndpoints)
    .set({
      active: true,
      disabledAt: null,
      disabledReason: null,
      consecutiveFailures: 0,
    })
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)));
  revalidatePath("/settings/webhooks");
}

export { EVENT_TYPES };

// Helper re-exported for the admin UI where needed.
export async function getActiveWebhookEndpointsForUser(
  userId: string,
): Promise<WebhookEndpointRow[]> {
  return db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.userId, userId),
        eq(webhookEndpoints.active, true),
        isNull(webhookEndpoints.disabledAt),
      ),
    );
}
