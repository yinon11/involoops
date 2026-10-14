"use server";

/*
 * Outbound invoice writes — UI-facing server actions.
 *
 * Implementation lives in `src/lib/outbound/operations.ts`. This file
 * resolves the calling user from the session, then delegates. The same
 * operations module is used by the public REST API
 * (`src/app/api/v1/outbound-invoices/*`) so there is one source of truth
 * for compliance invariants (Spec 01 sequencing, Spec 02 audit, Spec 03
 * RBAC, Spec 04 immutability).
 */

import { revalidatePath } from "next/cache";
import {
  callerFromUserId,
  cancelQueuedOutboundInvoiceDeliveryOp,
  createOutboundInvoiceOp,
  deleteOutboundInvoiceOp,
  getOutboundInvoiceByIdOp,
  getReceiptParentForCreate,
  getSourceForTaxInvoiceConversion,
  cancelAfterShaamRejectionOp,
  cancelAfterVoluntaryAllocationDeclineOp,
  issueOutboundInvoiceOp,
  listOutboundInvoicesOp,
  queueOutboundInvoiceForDeliveryOp,
  sendOutboundInvoiceByEmailOp,
  updateOutboundInvoiceDraftOp,
  updateOutboundInvoicePdfUrlOp,
  updateOutboundInvoiceStatusOp,
  type CallerContext,
  type CancelQueuedDeliveryResult,
  type CancelAfterShaamRejectionResult,
  type CreateOutboundInput,
  type IssueOutboundInvoiceOptions,
  type QueueOutboundInvoiceForDeliveryInput,
  type QueueOutboundInvoiceForDeliveryResult,
  type SendOutboundInvoiceByEmailInput,
  type SendOutboundInvoiceByEmailResult,
  type UpdateOutboundDraftInput,
} from "@/lib/outbound/operations";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";
import { requireActorUserId } from "@/lib/team/enforce";

async function requireCaller(
  cap?: "view_outbound" | "manage_outbound",
): Promise<CallerContext> {
  const userId = await requireActorUserId(cap);
  return callerFromUserId(userId);
}

export async function getOutboundInvoices() {
  const caller = await requireCaller("view_outbound");
  return listOutboundInvoicesOp(caller);
}

export async function getOutboundInvoiceById(id: string) {
  const caller = await requireCaller("view_outbound");
  return getOutboundInvoiceByIdOp(caller, id);
}

/**
 * Server-side loader for the "Issue Receipt for this invoice" flow.
 * Validates that the caller can issue a receipt against `parentInvoiceId`
 * and returns the prefill payload (parent number, customer, outstanding
 * amount, currency). Throws on every ineligibility — the page renders
 * a friendly error instead of the form when this throws.
 */
export async function getReceiptParentPrefill(parentInvoiceId: string) {
  const caller = await requireCaller("view_outbound");
  return getReceiptParentForCreate(caller, parentInvoiceId);
}

/**
 * Server-side loader for the "Convert proforma / delivery note → tax
 * invoice" flow. Returns the prefill bundle (items, customer, totals,
 * currency) so /outbound/new can render the form pre-filled with the
 * source's contents and link the new TI back via `referencesDocumentId`.
 */
export async function getConversionSourcePrefill(sourceId: string) {
  const caller = await requireCaller("view_outbound");
  return getSourceForTaxInvoiceConversion(caller, sourceId);
}

export async function createOutboundInvoice(data: CreateOutboundInput) {
  const caller = await requireCaller("manage_outbound");
  const row = await createOutboundInvoiceOp(caller, data);
  revalidatePath("/outbound");
  return row;
}

/**
 * `options.onRejection` carries the seller's answer to the rejection
 * dialog back into the issue flow. The first call is always made without
 * it: we cannot ask the question until the ITA has actually refused.
 */
export async function issueOutboundInvoice(
  invoiceId: string,
  options?: IssueOutboundInvoiceOptions,
) {
  const caller = await requireCaller("manage_outbound");
  const result = await issueOutboundInvoiceOp(caller, invoiceId, options);
  if (result.replacementInvoiceId) {
    revalidatePath(`/outbound/${result.replacementInvoiceId}`);
  }
  if (result.success) {
    revalidatePath("/outbound");
    revalidatePath("/invoices");
    revalidatePath(`/outbound/${invoiceId}`);
    // Refresh recommendations in background — do not await.
    import("@/features/generator/lib/recommendation-engine")
      .then(({ generateRecommendations }) =>
        generateRecommendations(caller.userId),
      )
      .catch(console.error);
  }
  return result;
}

/**
 * Option 1 of the rejection dialog — the seller gives up on the sale.
 * Voids the document in place and leaves the spent fiscal number in the
 * series as an explained gap (see `cancelAfterShaamRejectionOp`).
 */
export async function cancelAfterShaamRejection(
  invoiceId: string,
): Promise<CancelAfterShaamRejectionResult> {
  const caller = await requireCaller("manage_outbound");
  const result = await cancelAfterShaamRejectionOp(caller, invoiceId);
  if (result.success) {
    revalidatePath("/outbound");
    revalidatePath(`/outbound/${invoiceId}`);
  }
  return result;
}

/**
 * The seller declined to issue after a voluntary allocation refusal.
 * Voids the unsigned document and keeps the spent number in the series.
 */
export async function cancelAfterVoluntaryAllocationDecline(
  invoiceId: string,
): Promise<CancelAfterShaamRejectionResult> {
  const caller = await requireCaller("manage_outbound");
  const result = await cancelAfterVoluntaryAllocationDeclineOp(
    caller,
    invoiceId,
  );
  if (result.success) {
    revalidatePath("/outbound");
    revalidatePath(`/outbound/${invoiceId}`);
  }
  return result;
}

export async function updateOutboundInvoiceStatus(
  id: string,
  status: OutboundInvoiceStatus,
) {
  const caller = await requireCaller("manage_outbound");
  const row = await updateOutboundInvoiceStatusOp(caller, id, status);
  revalidatePath("/outbound");
  return row;
}

export async function updateOutboundInvoicePdfUrl(id: string, pdfUrl: string) {
  const caller = await requireCaller("manage_outbound");
  await updateOutboundInvoicePdfUrlOp(caller, id, pdfUrl);
}

export async function updateOutboundInvoiceDraft(
  id: string,
  patch: UpdateOutboundDraftInput,
) {
  const caller = await requireCaller("manage_outbound");
  const row = await updateOutboundInvoiceDraftOp(caller, id, patch);
  revalidatePath("/outbound");
  revalidatePath(`/outbound/${id}`);
  return row;
}

export async function deleteOutboundInvoice(id: string) {
  const caller = await requireCaller("manage_outbound");
  await deleteOutboundInvoiceOp(caller, id);
  revalidatePath("/outbound");
}

export type SendOutboundInvoiceInput = SendOutboundInvoiceByEmailInput;
export type SendOutboundInvoiceResult = SendOutboundInvoiceByEmailResult;

/**
 * Email a signed outbound invoice to its customer with the PDF attached.
 * UI entry point (Xero/FreshBooks-style send modal). Logic lives in
 * `sendOutboundInvoiceByEmailOp` so the public API's
 * POST /outbound-invoices/{id}/send route can reuse it.
 */
export async function sendOutboundInvoiceByEmail(
  input: SendOutboundInvoiceInput,
): Promise<SendOutboundInvoiceResult> {
  const caller = await requireCaller("manage_outbound");
  const result = await sendOutboundInvoiceByEmailOp(caller, input);
  if (result.success) {
    revalidatePath("/outbound");
    revalidatePath(`/outbound/${input.invoiceId}`);
  }
  return result;
}

/**
 * Capture the seller's send intent on an invoice that is currently
 * blocked by the SHAAM gate. The cron picks the queued params up the
 * moment SHAAM clears and fires the send automatically.
 */
export async function queueOutboundInvoiceForDelivery(
  input: QueueOutboundInvoiceForDeliveryInput,
): Promise<QueueOutboundInvoiceForDeliveryResult> {
  const caller = await requireCaller("manage_outbound");
  const result = await queueOutboundInvoiceForDeliveryOp(caller, input);
  if (result.success) {
    revalidatePath("/outbound");
    revalidatePath(`/outbound/${input.invoiceId}`);
  }
  return result;
}

export async function cancelQueuedOutboundInvoiceDelivery(
  invoiceId: string,
): Promise<CancelQueuedDeliveryResult> {
  const caller = await requireCaller("manage_outbound");
  const result = await cancelQueuedOutboundInvoiceDeliveryOp(caller, invoiceId);
  if (result.success) {
    revalidatePath("/outbound");
    revalidatePath(`/outbound/${invoiceId}`);
  }
  return result;
}
