/**
 * Event catalog for the public webhook system. Single source of truth:
 *   - UI endpoint-create dialog reads EVENT_TYPES for the checkbox grid.
 *   - Emitters pick event types from the union below.
 *   - OpenAPI generation references this list.
 *
 * New events are additive: once an event type ships, we never rename or
 * reshape its payload within the same major API version.
 */

export const EVENT_TYPES = [
  "outbound_invoice.created",
  "outbound_invoice.issued",
  "outbound_invoice.sent",
  "outbound_invoice.paid",
  "outbound_invoice.voided",
  "outbound_invoice.credit_note_issued",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "invoice.processed",
  "invoice.processing_failed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const EVENT_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_SET.has(value);
}

/**
 * Does an endpoint's subscription list match this event type?
 * Today we accept only exact matches; future additions may support
 * prefix globs like `outbound_invoice.*`.
 */
export function endpointSubscribes(
  endpointEvents: readonly string[],
  eventType: string,
): boolean {
  for (const e of endpointEvents) {
    if (e === eventType) return true;
    if (e === "*") return true;
    if (e.endsWith(".*") && eventType.startsWith(e.slice(0, -1))) return true;
  }
  return false;
}
