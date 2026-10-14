import type { WebhookEndpointRow } from "@/db/schema/webhooks";

export function serializeWebhookEndpoint(row: WebhookEndpointRow) {
  return {
    object: "webhook_endpoint",
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    active: row.active,
    secret_hint: row.secretHint,
    created_at: row.createdAt.toISOString(),
    last_delivery_at: row.lastDeliveryAt?.toISOString() ?? null,
    last_success_at: row.lastSuccessAt?.toISOString() ?? null,
    consecutive_failures: row.consecutiveFailures,
    disabled_at: row.disabledAt?.toISOString() ?? null,
    disabled_reason: row.disabledReason,
  };
}
