/**
 * Spec 06 — credit-note (חשבונית זיכוי) domain validation.
 *
 * Credit notes are the ONLY lawful correction path for issued tax
 * invoices under Israeli bookkeeping rules. This module enforces the
 * business rules as a pure function so the server action, the UI form,
 * and `scripts/verify-credit-notes.ts` share one source of truth.
 */

import { compareMoney } from "@/lib/money";
import type { DocumentType } from "@/lib/documents/types";

export type CreditableOriginal = {
  id: string;
  businessEntityId: string;
  documentType: DocumentType;
  status: string;
  total: string | number;
  netOfCreditsAmount: string | null;
};

export type CreditNoteValidationError =
  | "wrong_document_type"
  | "draft_cannot_be_credited"
  | "already_voided"
  | "already_fully_credited"
  | "cross_tenant"
  | "amount_not_positive"
  | "amount_exceeds_remaining"
  | "reason_too_short";

export type CreditNoteValidationResult =
  | { valid: true; linkType: "CREDIT_REVERSES" | "CREDIT_PARTIAL"; remainingAfter: string }
  | { valid: false; error: CreditNoteValidationError };

export function validateCreditNoteRequest(params: {
  original: CreditableOriginal;
  actingBusinessEntityId: string;
  creditAmount: string;
  reason: string;
}): CreditNoteValidationResult {
  const { original, actingBusinessEntityId, creditAmount, reason } = params;

  if (original.businessEntityId !== actingBusinessEntityId) {
    return { valid: false, error: "cross_tenant" };
  }

  if (
    original.documentType !== "TAX_INVOICE" &&
    original.documentType !== "TAX_INVOICE_RECEIPT"
  ) {
    return { valid: false, error: "wrong_document_type" };
  }

  if (original.status === "draft") {
    return { valid: false, error: "draft_cannot_be_credited" };
  }
  if (original.status === "voided") {
    return { valid: false, error: "already_voided" };
  }

  if (compareMoney(creditAmount, "0") <= 0) {
    return { valid: false, error: "amount_not_positive" };
  }

  const remaining = original.netOfCreditsAmount ?? String(original.total);
  if (compareMoney(remaining, "0") <= 0) {
    return { valid: false, error: "already_fully_credited" };
  }

  const cmp = compareMoney(creditAmount, remaining);
  if (cmp > 0) {
    return { valid: false, error: "amount_exceeds_remaining" };
  }

  if (!reason || reason.trim().length < 10) {
    return { valid: false, error: "reason_too_short" };
  }

  return {
    valid: true,
    linkType: cmp === 0 ? "CREDIT_REVERSES" : "CREDIT_PARTIAL",
    remainingAfter:
      cmp === 0 ? "0.00" : subtractStr(remaining, creditAmount),
  };
}

function subtractStr(a: string, b: string): string {
  const cents = Math.round(Number(a) * 100) - Math.round(Number(b) * 100);
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  return `${whole}.${String(frac).padStart(2, "0")}`;
}
