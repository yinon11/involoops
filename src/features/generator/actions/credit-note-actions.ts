"use server";

/*
 * Spec 06 — credit-note issuance (חשבונית זיכוי).
 *
 * Implementation lives in `src/lib/outbound/credit-note-op.ts`. This file
 * resolves the caller from the session and delegates. The same op module
 * is called by the public REST API
 * (`src/app/api/v1/outbound-invoices/{id}/credit-note`) so there is one
 * source of truth for compliance invariants (FOR UPDATE on the original,
 * gapless sequence allocation, Spec-04 sign + archive + SHAAM submission).
 */

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";
import {
  callerFromUserIdForCredit,
  issueCreditNoteOp,
  type IssueCreditNoteInput,
  type IssueCreditNoteResult,
} from "@/lib/outbound/credit-note-op";
import { getDictionary } from "@/lib/i18n/server";

export interface IssueCreditNoteParams {
  originalInvoiceId: string;
  creditAmount: string;
  reason: string;
  lines?: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    vatRate: string;
  }>;
}

export async function issueCreditNote(
  params: IssueCreditNoteParams,
): Promise<IssueCreditNoteResult> {
  const dict = await getDictionary();
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: dict.errors.notAuthorized };
  }
  const caller = await callerFromUserIdForCredit(session.user.id);
  const result = await issueCreditNoteOp(caller, params as IssueCreditNoteInput);
  if (result.success) {
    revalidatePath("/outbound");
    revalidatePath("/invoices");
    revalidatePath(`/outbound/${params.originalInvoiceId}`);
    revalidatePath(`/outbound/${result.creditNoteId}`);
  }
  return result;
}

/**
 * List customers that have at least one invoice eligible to be
 * credited (TAX_INVOICE or TAX_INVOICE_RECEIPT in issued/sent/paid
 * state with positive remaining balance). Feeds the new-credit
 * picker's step 1 (customer chooser).
 */
export async function getCustomersWithCreditableInvoices(): Promise<
  Array<{ id: string; name: string; invoiceCount: number }>
> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const entity = await getBusinessEntityForUser(session.user.id);
  const rows = await db.execute<{
    id: string;
    name: string;
    invoice_count: string;
  }>(sql`
    SELECT c.id, c.name, COUNT(oi.id)::text AS invoice_count
    FROM customers c
    INNER JOIN outbound_invoices oi ON oi.customer_id = c.id
    WHERE oi.business_entity_id = ${entity.id}
      AND oi.deleted_at IS NULL
      AND oi.document_type IN ('TAX_INVOICE', 'TAX_INVOICE_RECEIPT')
      AND oi.status IN ('issued', 'sent', 'paid')
      AND COALESCE(oi.net_of_credits_amount, oi.total) > 0
    GROUP BY c.id, c.name
    ORDER BY c.name ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    invoiceCount: Number(r.invoice_count),
  }));
}

/**
 * List creditable invoices for a specific customer. Used by the
 * new-credit picker's step 2 (invoice chooser).
 */
export async function getCreditableInvoicesForCustomer(
  customerId: string,
): Promise<
  Array<{
    id: string;
    formattedNumber: string;
    documentType: "TAX_INVOICE" | "TAX_INVOICE_RECEIPT";
    invoiceDate: string;
    total: number;
    remaining: number;
    currency: string;
    allocationNumber: string | null;
  }>
> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const entity = await getBusinessEntityForUser(session.user.id);
  const rows = await db.execute<{
    id: string;
    formatted_number: string;
    document_type: "TAX_INVOICE" | "TAX_INVOICE_RECEIPT";
    invoice_date: string;
    total: string;
    remaining: string;
    currency: string | null;
    allocation_number: string | null;
  }>(sql`
    SELECT id, formatted_number, document_type, invoice_date, total,
           COALESCE(net_of_credits_amount, total) AS remaining,
           currency, allocation_number
    FROM outbound_invoices
    WHERE business_entity_id = ${entity.id}
      AND customer_id = ${customerId}
      AND deleted_at IS NULL
      AND document_type IN ('TAX_INVOICE', 'TAX_INVOICE_RECEIPT')
      AND status IN ('issued', 'sent', 'paid')
      AND COALESCE(net_of_credits_amount, total) > 0
    ORDER BY invoice_date DESC, formatted_number DESC
  `);
  // Postgres `numeric` columns come back as strings via `db.execute`. Coerce
  // to numbers at the boundary so the UI gets the type it declares and so
  // strict equality on totals (e.g. "fully outstanding?") isn't tripped up
  // by lexical drift like "100" !== "100.00". Currency totals are well
  // within JS-number precision for invoicing.
  return rows.map((r) => ({
    id: r.id,
    formattedNumber: r.formatted_number,
    documentType: r.document_type,
    invoiceDate: r.invoice_date,
    total: Number(r.total),
    remaining: Number(r.remaining),
    currency: r.currency ?? "ILS",
    allocationNumber: r.allocation_number,
  }));
}
