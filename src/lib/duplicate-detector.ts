/**
 * Duplicate invoice detection utilities.
 */

import { createHash } from "crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";

/**
 * Generate a SHA-256 hash of a file buffer for exact duplicate detection.
 */
export function generateFileHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface SemanticDuplicateInput {
  userId: string;
  vendorId: string | null;
  invoiceNumber: string | null | undefined;
  amount: number | string | null | undefined;
  invoiceDate: string | null | undefined; // YYYY-MM-DD
  /**
   * When provided, this invoice id is excluded from the search — used when
   * re-checking an existing invoice after an edit so it doesn't match itself.
   */
  excludeInvoiceId?: string;
}

function normalizeAmount(
  amount: number | string | null | undefined
): string | null {
  if (amount == null) return null;
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return null;
  return n.toString();
}

/**
 * Hard-block semantic duplicate: an existing non-rejected invoice for the same user
 * with matching vendor, invoice number, amount, and invoice date. Requires all four
 * identifying fields to be present on the new invoice — otherwise returns null to
 * avoid false positives (e.g. receipts without an invoice number).
 *
 * Returns the existing invoice's id, or null if no match.
 */
export async function findSemanticDuplicate(
  input: SemanticDuplicateInput
): Promise<string | null> {
  const { userId, vendorId, invoiceNumber, invoiceDate, excludeInvoiceId } =
    input;

  const trimmedNumber = invoiceNumber?.trim();
  const amount = normalizeAmount(input.amount);
  if (!vendorId || !trimmedNumber || !amount || !invoiceDate) {
    return null;
  }

  const match = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.userId, userId),
      eq(invoices.vendorId, vendorId),
      eq(invoices.invoiceNumber, trimmedNumber),
      eq(invoices.amount, amount),
      eq(invoices.invoiceDate, invoiceDate),
      ne(invoices.status, "rejected"),
      excludeInvoiceId ? ne(invoices.id, excludeInvoiceId) : undefined
    ),
    columns: { id: true },
  });

  return match?.id ?? null;
}

/**
 * Soft-warn duplicate: any existing non-rejected invoice for the same user with the
 * same invoice number. Weaker signal than {@link findSemanticDuplicate} — these pairs
 * surface on the /duplicates page so the user can resolve them side-by-side.
 *
 * Returns the existing invoice's id, or null if no match.
 */
export async function findInvoiceNumberDuplicate(
  userId: string,
  invoiceNumber: string | null | undefined,
  excludeInvoiceId?: string
): Promise<string | null> {
  const trimmedNumber = invoiceNumber?.trim();
  if (!trimmedNumber) return null;

  const match = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.userId, userId),
      eq(invoices.invoiceNumber, trimmedNumber),
      ne(invoices.status, "rejected"),
      excludeInvoiceId ? ne(invoices.id, excludeInvoiceId) : undefined
    ),
    columns: { id: true },
  });

  return match?.id ?? null;
}
