export type InvoiceType = 'expense' | 'income';
export type InvoiceStatus = 'processing' | 'pending' | 'approved' | 'rejected';
export type ExtractionMethod = 'text' | 'vision' | 'manual';

export interface ExtractedInvoiceData {
  invoiceDate: string | null; // ISO date string
  vendorName: string | null;
  amount: number | null;
  currency: string | null; // 'ILS', 'USD', etc.
  /** Same total in USD (approximate) for reporting; original currency stays in amount + currency. */
  amountUsd: number | null;
  vatAmount: number | null;
  amountWithoutVat: number | null;
  invoiceNumber: string | null;
  description: string | null;
  /**
   * Short label for what was purchased (e.g. "computer", "vehicle",
   * "office furniture", "software license", "phone"). Null when unclear.
   */
  expenseCategory: string | null;
  /**
   * True when the purchase looks like a capital expenditure — typically
   * depreciated over multiple years (computer, phone, vehicle, machinery,
   * furniture, multi-year software license). False for consumables,
   * services, rent, utilities, food. Defaults to false on classification
   * failure so the existing flow is undisrupted.
   */
  isFixedAsset: boolean;
}

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ExtractionResult {
  data: ExtractedInvoiceData;
  confidence: number; // 0-1
  method: ExtractionMethod;
  rawText: string;
  /** Page count of the source PDF when known (0 when extraction failed). */
  pageCount: number;
  matchedVendorId: string | null;
  /**
   * True when the pipeline caught an exception and fell back to an empty
   * result. Callers use this to force `status: "pending"` so the user can
   * fix the invoice manually instead of it being silently auto-approved.
   */
  extractionFailed: boolean;
  llmUsage: LlmTokenUsage;
}
