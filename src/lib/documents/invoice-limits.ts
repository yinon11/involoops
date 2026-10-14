/** Printed invoice size. A document may run past one page. */
export const MAX_INVOICE_LINES = 50;
export const MAX_LINE_DESCRIPTION_LENGTH = 500;
export const MAX_INVOICE_NOTES_LENGTH = 4000;

/**
 * Returns an English error when a draft would exceed the printed limits.
 * Omitted fields are not checked, so a patch that only changes the date
 * still saves.
 */
export function invoiceContentLimitMessage(input: {
  items?: { description?: string | null }[] | null;
  notes?: string | null;
}): string | null {
  const items = input.items;
  if (items && items.length > MAX_INVOICE_LINES) {
    return `An invoice can have at most ${MAX_INVOICE_LINES} lines.`;
  }
  if (
    items?.some(
      (line) => (line.description ?? "").length > MAX_LINE_DESCRIPTION_LENGTH,
    )
  ) {
    return `Each line description can be at most ${MAX_LINE_DESCRIPTION_LENGTH} characters.`;
  }
  if ((input.notes ?? "").length > MAX_INVOICE_NOTES_LENGTH) {
    return `Notes can be at most ${MAX_INVOICE_NOTES_LENGTH} characters.`;
  }
  return null;
}
