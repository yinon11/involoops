/**
 * What to print as the document's number.
 *
 * A fiscal number can be reserved before the document is issued — the Tax
 * Authority is asked with that number, and saying "don't issue" leaves the
 * draft in place so the same number is reused. Until the document is
 * issued, that number must not appear on the page or the PDF. It would
 * read as a finished invoice.
 */
export function displayDocumentNumber(doc: {
  id: string;
  status: string | null | undefined;
  formattedNumber: string | null | undefined;
}): string {
  if ((doc.status ?? "draft") !== "draft" && doc.formattedNumber) {
    return doc.formattedNumber;
  }
  return `DRAFT-${doc.id.slice(0, 8)}`;
}
