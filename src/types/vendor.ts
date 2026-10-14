export interface VendorRule {
  /** `null` = global rule (all invoices). Otherwise vendor-specific. */
  vendorId: string | null;
  /** Row order from `extraction_rules.priority` (lower first). */
  priority?: number;
  /**
   * Free-form notes for extraction (shown to the text LLM when this vendor matches).
   * Stored in DB JSON as `{ instructions: "..." }`.
   */
  instructions?: string;
  /** @deprecated Legacy regex-based rules; prefer `instructions`. */
  identifiers?: string[];
  dateSelector?: {
    pattern: string; // regex string
    group: number;
    format: string; // date-fns format
  };
  amountSelector?: {
    pattern: string;
    group: number;
    multiplier?: number;
  };
  vatSelector?: {
    pattern: string;
    group: number;
  };
  invoiceNumberSelector?: {
    pattern: string;
    group: number;
  };
  currencyOverride?: string;
}
