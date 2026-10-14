/**
 * Diagonal mark printed on a document that is not a clean issued
 * original. The on-screen preview and the PDF download both read
 * these words so the two views cannot drift.
 */
export type DocumentWatermark = "draft" | "voided";

const WATERMARK_LABEL = {
  draft: { he: "טיוטה", en: "DRAFT" },
  voided: { he: "בוטל", en: "CANCELLED" },
} as const;

export function documentWatermarkLabel(
  language: string | null | undefined,
  kind: DocumentWatermark,
): string {
  const lang = language === "he" ? "he" : "en";
  return WATERMARK_LABEL[kind][lang];
}
