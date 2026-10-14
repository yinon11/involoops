/**
 * Per-entity SHAAM sandbox. A sandboxed business must never be sent to
 * the production ITA clearance API. Allocation uses the ITA test path
 * only when that entity has an active UAT grant; otherwise the result
 * is a local mock with an obviously fake allocation number.
 */

export const SANDBOX_DOCUMENT_MARK = "SANDBOX – not a valid tax document";

/** Stable, non-numeric allocation so it cannot be mistaken for an ITA confirmation. */
export function sandboxMockAllocationNumber(documentId: string): string {
  const compact = documentId.replace(/-/g, "").slice(0, 16).toUpperCase();
  return `TEST-${compact}`;
}
