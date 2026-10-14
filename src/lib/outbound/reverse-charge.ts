import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { outboundInvoices, reverseChargeConsents } from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { compareMoney, formatMoney } from "@/lib/money";
import { STATUTORY_VAT_RATE } from "@/lib/documents/vat";
import {
  currentValidConsent,
  latestConsentFor,
  paymentsMismatch,
  REVERSE_CHARGE_DOCUMENT_TYPES,
  snapshotForDocument,
} from "@/lib/outbound/reverse-charge-consent";
import type { CallerContext } from "@/lib/outbound/operations";

/**
 * Reverse charge, route A (ITA v2.0 spec §2.2.2): the seller issues at
 * zero VAT and the buyer reports and pays the VAT themselves.
 *
 * A tax invoice, or a tax invoice-receipt whose recorded payments already
 * equal the amount without VAT. Payments are fixed when an invoice-receipt
 * is created and must add up to its total, so zeroing the VAT on one
 * created with VAT would leave payments that no longer match — in practice
 * this means an invoice-receipt created with "Include VAT" off.
 *
 * No ITA call is involved. A zero-VAT document carries no input VAT for
 * the buyer to deduct, so `requiresAllocation` excuses it (`zero_vat`) and
 * nothing is sent. Route B — reverse charge *after* the ITA refused an
 * invoice it already holds — is a different flow (`action=3`).
 */
export { REVERSE_CHARGE_DOCUMENT_TYPES };

type Result = { success: true } | { success: false; error: string };

async function loadDraft(caller: CallerContext, documentId: string) {
  const [row] = await db
    .select()
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.id, documentId),
        eq(outboundInvoices.businessEntityId, caller.businessEntityId),
        isNull(outboundInvoices.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Switch a draft to reverse charge: VAT to zero, total to the subtotal,
 * and the consent it rests on recorded on the document.
 *
 * `createConsentRequest` already converts the draft when the request is
 * sent, so in the normal flow this op never runs. It is the repair path:
 * reverse charge was removed (or VAT was put back by an edit) while a
 * signed consent still covers the draft, and the seller wants it back
 * without asking the buyer to sign again.
 *
 * Needs a signed consent that covers the draft as it is now. The consent
 * snapshot deliberately leaves VAT out, so this change does not invalidate
 * the consent it depends on — any other edit does.
 */
export async function applyReverseChargeOp(
  caller: CallerContext,
  documentId: string,
): Promise<Result> {
  const row = await loadDraft(caller, documentId);
  if (!row) return { success: false, error: "Invoice not found" };
  if (row.status !== "draft") {
    return { success: false, error: "Reverse charge can only be applied to a draft." };
  }
  if (!(REVERSE_CHARGE_DOCUMENT_TYPES as readonly string[]).includes(row.documentType)) {
    return {
      success: false,
      error:
        "Reverse charge is available on a tax invoice or a tax invoice-receipt only.",
    };
  }
  const mismatch = paymentsMismatch(row, row.subtotal);
  if (mismatch) return { success: false, error: mismatch };
  const consent = await currentValidConsent(documentId);
  if (!consent) {
    return {
      success: false,
      error:
        "The buyer has not signed a reverse-charge consent that covers this invoice as it is now.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(outboundInvoices)
      .set({
        reverseCharge: true,
        reverseChargeConsentId: consent.id,
        vatRate: "0.00",
        vatAmount: "0.00",
        total: formatMoney(row.subtotal),
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundInvoices.id, documentId));
    await appendAuditEntry({
      tx,
      businessEntityId: row.businessEntityId,
      userId: row.userId,
      documentId,
      documentType: row.documentType,
      eventType: "REVERSE_CHARGE_APPLIED",
      eventPayload: {
        consentId: consent.id,
        before: { vatRate: row.vatRate, vatAmount: row.vatAmount, total: row.total },
        after: { vatRate: "0.00", vatAmount: "0.00", total: formatMoney(row.subtotal) },
      },
      actor: { userId: caller.userId },
    });
  });
  return { success: true };
}

/**
 * The reverse-charge switch on the invoice page, turned on: the draft
 * becomes a reverse-charge invoice — VAT to zero, total to the subtotal —
 * before the buyer is asked to sign. Signing is the next step, and issuing
 * stays blocked until a signed consent covers the draft
 * (`reverseChargeIssueCheck`), so this cannot produce an unsigned
 * zero-VAT invoice.
 *
 * Also the repair path: a draft marked reverse charge that got VAT back
 * through an edit is zeroed again. A signed consent that still covers the
 * draft is recorded on it, as `applyReverseChargeOp` does.
 */
export async function switchOnReverseChargeOp(
  caller: CallerContext,
  documentId: string,
): Promise<Result> {
  const row = await loadDraft(caller, documentId);
  if (!row) return { success: false, error: "Invoice not found" };
  if (row.status !== "draft") {
    return { success: false, error: "An issued invoice cannot be changed." };
  }
  if (!(REVERSE_CHARGE_DOCUMENT_TYPES as readonly string[]).includes(row.documentType)) {
    return {
      success: false,
      error:
        "Reverse charge is available on a tax invoice or a tax invoice-receipt only.",
    };
  }
  if (row.reverseCharge && compareMoney(row.vatAmount ?? "0", "0") === 0) {
    return { success: true };
  }
  // The buyer must be able to report the VAT themselves; the same check
  // the consent request runs, so the switch never leads to a request that
  // can only be refused.
  const snap = await snapshotForDocument(documentId);
  if (!snap.ok) return { success: false, error: snap.error };
  const mismatch = paymentsMismatch(row, row.subtotal);
  if (mismatch) return { success: false, error: mismatch };

  const consent = await currentValidConsent(documentId);
  const after = { vatRate: "0.00", vatAmount: "0.00", total: formatMoney(row.subtotal) };
  await db.transaction(async (tx) => {
    await tx
      .update(outboundInvoices)
      .set({
        reverseCharge: true,
        reverseChargeConsentId: consent?.id ?? null,
        ...after,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundInvoices.id, documentId));
    await appendAuditEntry({
      tx,
      businessEntityId: row.businessEntityId,
      userId: row.userId,
      documentId,
      documentType: row.documentType,
      eventType: "REVERSE_CHARGE_APPLIED",
      eventPayload: {
        reason: "switch_on",
        consentId: consent?.id ?? null,
        before: { vatRate: row.vatRate, vatAmount: row.vatAmount, total: row.total },
        after,
      },
      actor: { userId: caller.userId },
    });
  });
  return { success: true };
}

/** Back to an ordinary invoice at the statutory rate. */
export async function removeReverseChargeOp(
  caller: CallerContext,
  documentId: string,
): Promise<Result> {
  const row = await loadDraft(caller, documentId);
  if (!row) return { success: false, error: "Invoice not found" };
  if (row.status !== "draft") {
    return { success: false, error: "An issued invoice cannot be changed." };
  }
  if (!row.reverseCharge) return { success: true };

  // Route B: a replacement already under way. A draft one (no number yet)
  // goes with the reverse charge; one that holds a number is past undoing.
  const replacement = await findActiveReplacement(row.id);
  if (replacement?.formattedNumber) {
    return {
      success: false,
      error: `This invoice is already being replaced by ${replacement.formattedNumber} under reverse charge.`,
    };
  }

  // An invoice-receipt keeps its amounts: its payments were fixed at
  // creation to the zero-VAT total, and restoring VAT would break them.
  // Removing reverse charge there only drops the flag and the caption.
  const subtotal = Number(row.subtotal);
  const vatAmount = Math.round(subtotal * STATUTORY_VAT_RATE) / 100;
  const after =
    row.documentType === "TAX_INVOICE_RECEIPT"
      ? {
          vatRate: formatMoney(row.vatRate ?? 0),
          vatAmount: formatMoney(row.vatAmount ?? 0),
          total: formatMoney(row.total),
        }
      : {
          vatRate: formatMoney(STATUTORY_VAT_RATE),
          vatAmount: formatMoney(vatAmount),
          total: formatMoney(subtotal + vatAmount),
        };

  await db.transaction(async (tx) => {
    if (replacement) {
      await tx
        .update(outboundInvoices)
        .set({ deletedAt: new Date(), deletedBy: caller.userId, updatedAt: new Date() })
        .where(eq(outboundInvoices.id, replacement.id));
    }
    // A live signing link outlasting the reverse charge would let the buyer
    // sign a consent for a document the seller has decided to issue with
    // VAT. Signed consents stay — they are the buyer's record.
    await tx
      .update(reverseChargeConsents)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(reverseChargeConsents.documentId, documentId),
          eq(reverseChargeConsents.status, "pending"),
        ),
      );
    await tx
      .update(outboundInvoices)
      .set({
        reverseCharge: false,
        reverseChargeConsentId: null,
        ...after,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundInvoices.id, documentId));
    await appendAuditEntry({
      tx,
      businessEntityId: row.businessEntityId,
      userId: row.userId,
      documentId,
      documentType: row.documentType,
      eventType: "REVERSE_CHARGE_REMOVED",
      eventPayload: {
        consentId: row.reverseChargeConsentId,
        before: { vatRate: row.vatRate, vatAmount: row.vatAmount, total: row.total },
        after,
      },
      actor: { userId: caller.userId },
    });
  });
  return { success: true };
}

/**
 * The check `issueOutboundInvoiceOp` runs on a reverse-charge draft before
 * it spends a fiscal number. Returns the consent to record, or why not.
 *
 * Re-checked at issue rather than trusted from `applyReverseChargeOp`: the
 * draft can be edited in between, and an edit to the lines or the amount
 * leaves a signature that covers a different transaction.
 */
export async function reverseChargeIssueCheck(row: {
  id: string;
  documentType: string;
  vatAmount: string | null;
  /** Route B: the consent was signed on the refused original. */
  reverseChargeReplacesId?: string | null;
}): Promise<
  | { ok: true; consentId: string }
  | {
      ok: false;
      error: string;
      /** The request is out and valid; the buyer just has not signed yet. */
      pendingSignature?: true;
    }
> {
  if (!(REVERSE_CHARGE_DOCUMENT_TYPES as readonly string[]).includes(row.documentType)) {
    return {
      ok: false,
      error: "Reverse charge is available on a tax invoice or a tax invoice-receipt only.",
    };
  }
  if (row.documentType === "TAX_INVOICE_RECEIPT") {
    const [full] = await db
      .select({
        documentType: outboundInvoices.documentType,
        payments: outboundInvoices.payments,
        currency: outboundInvoices.currency,
        total: outboundInvoices.total,
      })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, row.id))
      .limit(1);
    const mismatch = full ? paymentsMismatch(full, full.total) : "Invoice not found";
    if (mismatch) return { ok: false, error: mismatch };
  }
  if (compareMoney(row.vatAmount ?? "0", "0") !== 0) {
    return {
      ok: false,
      error:
        "This invoice is marked reverse charge but has VAT on it. Apply reverse charge again, or remove it.",
    };
  }
  // A replacement's consent was signed on the original. It is checked
  // against the replacement's own facts, so an edit to the replacement
  // draft voids it just as an edit to the original would.
  const consent = row.reverseChargeReplacesId
    ? await currentValidConsent(row.reverseChargeReplacesId, row.id)
    : await currentValidConsent(row.id);
  if (!consent) {
    // Requesting consent converts the draft, so the common way to get here
    // is simply issuing before the buyer signed — tell the seller that,
    // not that something is wrong.
    const latest = await latestConsentFor(
      row.reverseChargeReplacesId ?? row.id,
      row.id,
    );
    if (latest?.state === "pending") {
      return {
        ok: false,
        pendingSignature: true,
        error:
          "The buyer has not signed the reverse-charge consent yet. The invoice can be issued once they sign — or remove reverse charge to issue it with VAT.",
      };
    }
    return {
      ok: false,
      error:
        "The buyer's reverse-charge consent no longer covers this invoice (it changed after they signed, or there is no signed consent). Ask the buyer to sign again, or remove reverse charge.",
    };
  }
  return { ok: true, consentId: consent.id };
}

// ---------------------------------------------------------------------------
// Route B — reverse charge after an ITA refusal
// ---------------------------------------------------------------------------

/**
 * The replacement under way for a refused original: a non-deleted,
 * non-voided invoice that names it in `reverse_charge_replaces_id`, and
 * whose own request the ITA has not refused. (A refusal of a draft
 * replacement voids it at once; one issued during an outage and refused
 * later no longer stands in for the original, which the seller then
 * resolves another way.)
 */
export async function findActiveReplacement(originalId: string) {
  const [row] = await db
    .select()
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.reverseChargeReplacesId, originalId),
        isNull(outboundInvoices.deletedAt),
        sql`${outboundInvoices.status} <> 'voided'`,
        sql`${outboundInvoices.shaamStatus} IS DISTINCT FROM 'REJECTED'`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Route B (ITA v2.0 spec §2.2.2, third alternative): create — or return
 * the one already created — the zero-VAT invoice that replaces a refused
 * original.
 *
 * The spec and the ITA's own portal agree that this is a *new* invoice:
 * "A zero-rate invoice will receive a reference number in accordance with
 * the accepted rules"; "על מבקש ההקצאה (הספק) לבטל את החשבונית ולהוציא
 * במקומה חשבונית חדשה עם מע"מ בשיעור אפס". So the replacement is a fresh
 * draft with the original's details, zero VAT and no number; it gets its
 * own number when issued. Its allocation request carries the original's
 * Invoice_Id and action 3, and the original is cancelled (storno) only when
 * the special allocation number arrives — until then the original is the
 * one the ITA holds, and the seller may still pick another alternative.
 *
 * The original must be a refused or held draft with reverse charge applied
 * and a signed consent that covers it. Recording the choice is part of
 * this step, with who made it.
 */
export async function createReverseChargeReplacementOp(
  caller: CallerContext,
  originalId: string,
): Promise<{ success: true; replacementId: string } | { success: false; error: string }> {
  const original = await loadDraft(caller, originalId);
  if (!original) return { success: false, error: "Invoice not found" };
  if (original.status !== "draft" || !original.formattedNumber) {
    return {
      success: false,
      error: "Only an invoice the Tax Authority refused (still a draft, with its number) can be replaced under reverse charge.",
    };
  }
  if (original.shaamStatus !== "REJECTED" && original.shaamStatus !== "HELD") {
    return {
      success: false,
      error: `This invoice is not waiting on a Tax Authority refusal (status ${original.shaamStatus}).`,
    };
  }
  if (!original.reverseCharge) {
    return { success: false, error: "Apply reverse charge to the invoice first." };
  }

  const existing = await findActiveReplacement(original.id);
  if (existing) return { success: true, replacementId: existing.id };

  const check = await reverseChargeIssueCheck(original);
  if (!check.ok) return { success: false, error: check.error };

  const replacementId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(outboundInvoices)
      .values({
        userId: original.userId,
        businessEntityId: original.businessEntityId,
        templateId: original.templateId,
        customerId: original.customerId,
        customerEmail: original.customerEmail,
        documentType: original.documentType,
        taxYear: original.taxYear,
        invoiceDate: original.invoiceDate,
        dueDate: original.dueDate,
        items: original.items,
        payments: original.payments,
        subtotal: original.subtotal,
        vatRate: "0.00",
        vatAmount: "0.00",
        total: formatMoney(original.subtotal),
        netOfCreditsAmount: formatMoney(original.subtotal),
        currency: original.currency,
        language: original.language,
        notes: original.notes,
        status: "draft",
        reverseCharge: true,
        reverseChargeConsentId: check.consentId,
        reverseChargeReplacesId: original.id,
      })
      .returning({ id: outboundInvoices.id });

    await appendAuditEntry({
      tx,
      businessEntityId: original.businessEntityId,
      userId: original.userId,
      documentId: created.id,
      documentType: original.documentType,
      eventType: "CREATED",
      eventPayload: {
        reason: "reverse_charge_replacement",
        replaces: original.id,
        replacesFormattedNumber: original.formattedNumber,
        consentId: check.consentId,
      },
      actor: { userId: caller.userId },
    });

    // The seller's choice among the statutory alternatives, on the
    // original, with who made it — the request that follows is the choice.
    await tx
      .update(outboundInvoices)
      .set({
        shaamRejectionChoiceAt: new Date(),
        shaamRejectionChoiceBy: caller.userId,
        updatedAt: new Date(),
      })
      .where(eq(outboundInvoices.id, original.id));
    await appendAuditEntry({
      tx,
      businessEntityId: original.businessEntityId,
      userId: original.userId,
      documentId: original.id,
      documentType: original.documentType,
      eventType: "SHAAM_REJECTION_RESOLVED",
      eventPayload: {
        phase: "choice_recorded",
        choice: "reverse_charge",
        refusedStatus: original.shaamStatus,
        consentId: check.consentId,
        replacementId: created.id,
      },
      actor: { userId: caller.userId },
    });
    return created.id;
  });

  return { success: true, replacementId };
}

/**
 * The ITA refused the reverse-charge request itself. The replacement
 * already holds a fiscal number (allocated before the request, as for any
 * invoice), so it is voided — an explained gap, like the cancel
 * alternative — and nothing is issued. The original stays as it was: a
 * refused draft, for the seller to resolve another way.
 */
export async function abandonRefusedReplacement(params: {
  replacementId: string;
  actorUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, params.replacementId))
      .limit(1);
    if (!row || row.status !== "draft" || !row.formattedNumber) return;
    const now = new Date();
    await tx
      .update(outboundInvoices)
      .set({
        status: "voided",
        shaamStatus: "CANCELLED_AFTER_REJECTION",
        shaamRejectionChoice: "cancel",
        shaamRejectionChoiceAt: now,
        shaamRejectionChoiceBy: params.actorUserId,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: now,
      })
      .where(eq(outboundInvoices.id, row.id));
    await appendAuditEntry({
      tx,
      businessEntityId: row.businessEntityId,
      userId: row.userId,
      documentId: row.id,
      documentType: row.documentType,
      eventType: "SHAAM_REJECTION_RESOLVED",
      eventPayload: {
        phase: "choice_recorded",
        choice: "cancel",
        reason: "reverse_charge_refused",
        replaces: row.reverseChargeReplacesId,
        burntFormattedNumber: row.formattedNumber,
        burntSequenceNumber: row.sequenceNumber,
        errorCode: row.shaamLastErrorCode,
      },
      actor: { userId: params.actorUserId },
    });
  });
}
