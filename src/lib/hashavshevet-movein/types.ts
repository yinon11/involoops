/**
 * Hashavshevet MOVEIN journal-import format.
 *
 * Spec reference: the vendor's own documentation for importing text files as
 * journal entries (יבוא קבצי טקסט לפקודות יומן), which defines annexes א/ב/ג.
 */

/** Hashavshevet import method — see H-ERP annexes א/ב/ג. */
export type MoveinMethod = "flexible" | "short" | "detailed";

export const MOVEIN_SHORT_RECORD_LENGTH = 90;
export const MOVEIN_DETAILED_RECORD_LENGTH = 180;

/** MOVEIN data files are typically ASCII / Windows-1255. */
export const MOVEIN_ENCODING = "win1255" as const;

export interface MoveinFieldSpec {
  name: string;
  start: number;
  end: number;
}

export interface MoveinValidationIssue {
  recordNumber: number;
  field: string;
  rule: string;
  message: string;
}

export interface MoveinValidationResult {
  valid: boolean;
  method: MoveinMethod;
  recordLength: number;
  errors: MoveinValidationIssue[];
  warnings: MoveinValidationIssue[];
  movementCount: number;
  headerDeclaredCount: number | null;
}

/** GL card mapping — the "עדכון מספרי הכרטיסים" set Hashavshevet expects. */
export interface MoveinCardMapping {
  generalCash: string;
  creditCardCash: string;
  cash: string;
  checkCash: string;
  transferUsd: string;
  transferEur: string;
  transferGbp: string;
  transferJpy: string;
  paypal: string;
  bit: string;
  pepper: string;
  credit: string;
  purchase: string;
  inputVat: string;
  withholdingTax: string;
  outputVat: string;
  income: string;
  exemptIncome: string;
  cashCustomer: string;
}

export interface MoveinExportConfig {
  businessEntityId: string;
  method: MoveinMethod;
  cardMapping: MoveinCardMapping;
  /** Recipient for the generated MOVEIN archive. */
  exportEmail?: string;
}
