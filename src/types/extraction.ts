export interface TextExtractionResult {
  /**
   * Flat (space-joined) text — every glyph PDF.js reported, concatenated in
   * extractor order. Cheap to scan with regex; used for invoice-number,
   * amount, date and other field heuristics where layout doesn't matter.
   */
  text: string;
  /**
   * Layout-aware reconstruction of the same content: each row sits on its
   * own line and items inside the row are spaced to mirror their PDF x
   * position. Lets the LLM tell apart left/right columns in multi-column
   * Hebrew invoices (חשבשבת and friends) where `text` flattens the customer
   * block into the same line as the vendor block. Always equal to `text`
   * when positional reconstruction wasn't possible, so downstream code can
   * use it unconditionally.
   */
  layoutText: string;
  pageCount: number;
  isTextBased: boolean; // true if meaningful text was extracted
}
