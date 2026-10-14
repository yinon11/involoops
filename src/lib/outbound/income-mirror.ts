/**
 * Copy issued documents into the invoices list as approved income.
 *
 * Uploaded income and issued documents live in different tables. The
 * invoices page (the Income filter) only reads `invoices`, so a tax
 * invoice this business issued never appeared there. This writes one
 * approved income row per issued tax invoice, invoice-receipt, or
 * credit invoice and refreshes it from the issued row. A credit invoice
 * is stored as a negative amount. Receipts, proformas and delivery
 * notes are left out. The dashboard does not add these rows; it reads
 * the issued documents.
 *
 * The vendor is the issuing business, not the customer. When that
 * business already exists as a vendor (same name or alias), the row
 * is linked to it so the vendor filter includes it.
 *
 * An income invoice the user already uploaded for the same number is
 * left alone. Profit still counts that sale once, through the issued
 * document, and the list does not grow a second row.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema/invoices";

/**
 * Which issued rows count as income. `oi` must be the outbound_invoices
 * alias in the query this fragment is dropped into.
 */
const mirrorable = sql`
  oi.deleted_at IS NULL
  AND oi.document_type IN ('TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_INVOICE')
  AND (
    oi.status IN ('issued', 'sent', 'paid')
    OR (
      oi.document_type IN ('TAX_INVOICE', 'TAX_INVOICE_RECEIPT')
      AND oi.status = 'voided'
      AND EXISTS (
        SELECT 1 FROM document_links dl
        WHERE dl.to_document_id = oi.id
          AND dl.link_type = 'CREDIT_REVERSES'
      )
    )
  )
`;

/**
 * True when this income row is the same document as one this business
 * already issued. Profit adds that sale through `sumIssuedIncome`.
 * `invoices` is the row being tested.
 */
export const incomeCoveredByIssuedDocument = sql`
  ${invoices.type} = 'income'
  AND EXISTS (
    SELECT 1
    FROM outbound_invoices covered
    WHERE covered.user_id = ${invoices.userId}
      AND covered.deleted_at IS NULL
      AND covered.document_type IN ('TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_INVOICE')
      AND (
        covered.status IN ('issued', 'sent', 'paid')
        OR (
          covered.document_type IN ('TAX_INVOICE', 'TAX_INVOICE_RECEIPT')
          AND covered.status = 'voided'
          AND EXISTS (
            SELECT 1 FROM document_links dl
            WHERE dl.to_document_id = covered.id
              AND dl.link_type = 'CREDIT_REVERSES'
          )
        )
      )
      AND covered.formatted_number IS NOT NULL
      AND (
        lower(btrim(${invoices.invoiceNumber})) = lower(btrim(covered.formatted_number))
        OR (
          substring(lower(covered.formatted_number) from '((?:tir|ti|ci)-[0-9]+)') IS NOT NULL
          AND lower(${invoices.invoiceNumber}) ~ (
            substring(lower(covered.formatted_number) from '((?:tir|ti|ci)-[0-9]+)')
            || '([^0-9]|$)'
          )
        )
      )
  )
`;

/** Skip an issued document that already has an uploaded income row. */
const alreadyUploaded = sql`
  EXISTS (
    SELECT 1
    FROM invoices existing
    WHERE existing.user_id = oi.user_id
      AND existing.type = 'income'
      AND existing.outbound_invoice_id IS NULL
      AND existing.invoice_number IS NOT NULL
      AND (
        lower(btrim(existing.invoice_number)) = lower(btrim(oi.formatted_number))
        OR (
          substring(lower(oi.formatted_number) from '((?:tir|ti|ci)-[0-9]+)') IS NOT NULL
          AND lower(existing.invoice_number) ~ (
            substring(lower(oi.formatted_number) from '((?:tir|ti|ci)-[0-9]+)')
            || '([^0-9]|$)'
          )
        )
      )
  )
`;

/**
 * Upsert an approved income row for every issued revenue document this
 * user owns, and drop copies that are no longer an issued tax invoice
 * or invoice-receipt (voided without a credit, deleted, or another
 * document type).
 */
export async function mirrorIssuedIncomeForUser(userId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO invoices (
      user_id,
      vendor_id,
      type,
      status,
      invoice_number,
      invoice_date,
      amount,
      currency,
      vat_amount,
      amount_without_vat,
      suggested_vendor_name,
      file_url,
      file_name,
      extraction_method,
      added_month,
      outbound_invoice_id
    )
    SELECT
      oi.user_id,
      issuer_vendor.id,
      'income',
      'approved',
      oi.formatted_number,
      coalesce(oi.printed_date, oi.invoice_date),
      CASE
        WHEN oi.document_type = 'CREDIT_INVOICE' THEN -abs(oi.total)
        ELSE oi.total
      END,
      coalesce(oi.currency, 'ILS'),
      CASE
        WHEN oi.document_type = 'CREDIT_INVOICE' THEN -abs(oi.vat_amount)
        ELSE oi.vat_amount
      END,
      CASE
        WHEN oi.document_type = 'CREDIT_INVOICE' THEN -abs(oi.subtotal)
        ELSE oi.subtotal
      END,
      nullif(btrim(be.legal_name), ''),
      oi.pdf_url,
      CASE
        WHEN oi.formatted_number IS NOT NULL THEN oi.formatted_number || '.pdf'
        ELSE NULL
      END,
      'manual',
      to_char(coalesce(oi.printed_date, oi.invoice_date), 'YYYY-MM'),
      oi.id
    FROM outbound_invoices oi
    LEFT JOIN business_entities be ON be.id = oi.business_entity_id
    LEFT JOIN LATERAL (
      SELECT v.id
      FROM vendors v
      WHERE v.user_id = oi.user_id
        AND nullif(btrim(be.legal_name), '') IS NOT NULL
        AND (
          lower(btrim(v.name)) = lower(btrim(be.legal_name))
          OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(v.aliases, ARRAY[]::text[])) AS alias
            WHERE lower(btrim(alias)) = lower(btrim(be.legal_name))
          )
        )
      ORDER BY
        CASE
          WHEN lower(btrim(v.name)) = lower(btrim(be.legal_name)) THEN 0
          ELSE 1
        END,
        v.created_at
      LIMIT 1
    ) issuer_vendor ON true
    WHERE oi.user_id = ${userId}
      AND ${mirrorable}
      AND NOT ${alreadyUploaded}
    ON CONFLICT (outbound_invoice_id) DO UPDATE SET
      vendor_id = EXCLUDED.vendor_id,
      invoice_number = EXCLUDED.invoice_number,
      invoice_date = EXCLUDED.invoice_date,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      vat_amount = EXCLUDED.vat_amount,
      amount_without_vat = EXCLUDED.amount_without_vat,
      suggested_vendor_name = EXCLUDED.suggested_vendor_name,
      file_url = EXCLUDED.file_url,
      file_name = EXCLUDED.file_name,
      added_month = EXCLUDED.added_month,
      type = 'income',
      status = 'approved',
      updated_at = now()
  `);

  await db.execute(sql`
    DELETE FROM invoices i
    USING outbound_invoices oi
    WHERE i.user_id = ${userId}
      AND i.outbound_invoice_id = oi.id
      AND NOT (${mirrorable})
  `);

  // A manual upload of the same document (TIR-000007-#2026 vs
  // 2026-TIR-000007) is the row the user already has. Drop the copy.
  await db.execute(sql`
    DELETE FROM invoices mirrored
    WHERE mirrored.user_id = ${userId}
      AND mirrored.outbound_invoice_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM invoices existing
        WHERE existing.user_id = mirrored.user_id
          AND existing.id <> mirrored.id
          AND existing.type = 'income'
          AND existing.outbound_invoice_id IS NULL
          AND existing.invoice_number IS NOT NULL
          AND (
            lower(btrim(existing.invoice_number)) = lower(btrim(mirrored.invoice_number))
            OR (
              substring(lower(mirrored.invoice_number) from '((?:tir|ti|ci)-[0-9]+)') IS NOT NULL
              AND lower(existing.invoice_number) ~ (
                substring(lower(mirrored.invoice_number) from '((?:tir|ti|ci)-[0-9]+)')
                || '([^0-9]|$)'
              )
            )
          )
      )
  `);
}
