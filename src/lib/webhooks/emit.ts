import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { endpointSubscribes, type EventType } from "./events";
import { newRequestId } from "@/lib/api/request-id";

/**
 * Enqueue a webhook event. Looks up the user's active endpoints that
 * subscribe to this event type and inserts one `pending` delivery row
 * per endpoint. The cron worker drains these later.
 *
 * Best-effort: any failure here is logged but swallowed so an outage in
 * the webhook plumbing never blocks the primary operation (issuing an
 * invoice, etc.).
 */
export async function emitEvent(input: {
  userId: string;
  eventType: EventType;
  data: Record<string, unknown>;
  previousAttributes?: Record<string, unknown> | null;
  /** Optional request id to echo back in the payload (for correlation). */
  requestId?: string | null;
}): Promise<void> {
  try {
    const endpoints = await db
      .select({
        id: webhookEndpoints.id,
        events: webhookEndpoints.events,
      })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.userId, input.userId),
          eq(webhookEndpoints.active, true),
          isNull(webhookEndpoints.disabledAt),
        ),
      );

    const subscribers = endpoints.filter((e) =>
      endpointSubscribes(e.events, input.eventType),
    );
    if (subscribers.length === 0) return;

    const eventId = `evt_${newRequestId()}`;
    const createdAt = new Date().toISOString();

    const payload: Record<string, unknown> = {
      id: eventId,
      type: input.eventType,
      version: 1,
      created_at: createdAt,
      api_version: "v1",
      data: input.data,
    };
    if (input.previousAttributes) {
      payload.previous_attributes = input.previousAttributes;
    }
    if (input.requestId) {
      payload.request = { id: input.requestId };
    }

    await db.insert(webhookDeliveries).values(
      subscribers.map((e) => ({
        endpointId: e.id,
        userId: input.userId,
        eventId,
        eventType: input.eventType,
        payload,
        status: "pending",
      })),
    );
  } catch (err) {
    // Never propagate: webhook infra failures must not break the primary
    // operation. The outbound operations call this fire-and-forget, but
    // we still want to log so we notice sustained failures.
    console.error("[webhooks] emitEvent failed", {
      userId: input.userId,
      eventType: input.eventType,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
