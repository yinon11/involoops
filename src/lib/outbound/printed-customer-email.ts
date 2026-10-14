/**
 * Email printed in the customer block of a document.
 *
 * `snapshot` is the value stored on the document:
 *   - null / undefined — the document predates the field; use the
 *     customer record
 *   - "" — the seller cleared it; print nothing
 *   - anything else — print that address, even if the customer record
 *     has since changed
 */
export function printedCustomerEmail(
  snapshot: string | null | undefined,
  customerEmail: string | null | undefined,
): string | undefined {
  if (snapshot == null) {
    const live = (customerEmail ?? "").trim();
    return live || undefined;
  }
  const chosen = snapshot.trim();
  return chosen || undefined;
}
