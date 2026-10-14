import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  moveinExports,
  outboundInvoices,
} from "@/db/schema";
import { uploadFile } from "@/lib/storage";
import { buildMoveinExport } from "./build";
import {
  settingsRowToCardMapping,
  validateCardMappingComplete,
} from "./settings-mapper";
import type { moveinExportSettings } from "@/db/schema/movein-export";
import { validateMoveinFile } from "./validate";

const EXPORTABLE_STATUSES = ["issued", "sent", "paid"] as const;
const EXPORTABLE_DOC_TYPES = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
  "RECEIPT",
  "CREDIT_INVOICE",
] as const;

type SettingsRow = typeof moveinExportSettings.$inferSelect;

export function makeMoveinRunId(): string {
  const today = new Date().toISOString().slice(0, 10);
  const suffix = randomBytes(3).toString("hex");
  return `mv-${today}-${suffix}`;
}

export async function runMoveinExport(params: {
  businessEntityId: string;
  actorUserId: string;
  periodStart: string;
  periodEnd: string;
  settings: SettingsRow;
}): Promise<
  | { runId: string; movementCount: number; invoiceCount: number }
  | { error: string }
> {
  // Only the detailed annex is implemented. The settings form disables the
  // other two, but a settings row saved before that could still carry one, and
  // the builder would throw from deep inside the export instead of telling the
  // user what to change.
  if (params.settings.method !== "detailed") {
    return {
      error:
        `Export method "${params.settings.method}" is not implemented. ` +
        `Open Hashavshevet settings and set the export method to "detailed".`,
    };
  }

  const cards = settingsRowToCardMapping(params.settings);
  const missing = validateCardMappingComplete(cards);
  if (missing.length > 0) {
    return {
      error: `Card mapping incomplete — fill in: ${missing.join(", ")}`,
    };
  }

  const rows = await db
    .select({
      formattedNumber: outboundInvoices.formattedNumber,
      invoiceDate: outboundInvoices.invoiceDate,
      documentType: outboundInvoices.documentType,
      subtotal: outboundInvoices.subtotal,
      vatAmount: outboundInvoices.vatAmount,
      total: outboundInvoices.total,
      currency: outboundInvoices.currency,
      fxRateToIls: outboundInvoices.fxRateToIls,
      // Needed to split ניכוי מס במקור out of the receipt's cash leg.
      payments: outboundInvoices.payments,
      customerExternalAccount: customers.externalAccountNumber,
    })
    .from(outboundInvoices)
    .leftJoin(customers, eq(outboundInvoices.customerId, customers.id))
    .where(
      and(
        eq(outboundInvoices.businessEntityId, params.businessEntityId),
        inArray(outboundInvoices.status, [...EXPORTABLE_STATUSES]),
        inArray(outboundInvoices.documentType, [...EXPORTABLE_DOC_TYPES]),
        gte(outboundInvoices.invoiceDate, params.periodStart),
        lte(outboundInvoices.invoiceDate, params.periodEnd),
      ),
    );

  if (rows.length === 0) {
    return { error: "No issued invoices found for the selected period." };
  }

  const runId = makeMoveinRunId();

  try {
    const built = buildMoveinExport({
      config: {
        businessEntityId: params.businessEntityId,
        // Guaranteed "detailed" by the guard at the top of this function.
        method: "detailed",
        cardMapping: cards,
        exportEmail: params.settings.exportEmail ?? undefined,
      },
      invoices: rows.map((r) => ({
        formattedNumber: r.formattedNumber ?? r.invoiceDate,
        invoiceDate: new Date(`${r.invoiceDate}T12:00:00`),
        customerExternalAccount: r.customerExternalAccount,
        subtotal: Number(r.subtotal),
        vatAmount: Number(r.vatAmount ?? 0),
        total: Number(r.total),
        currency: r.currency ?? "ILS",
        fxRateToIls: r.fxRateToIls,
        documentType: r.documentType,
        payments: r.payments,
      })),
    });

    const validation = validateMoveinFile({
      data: built.data,
      method: built.method,
    });

    const zip = new JSZip();
    const ext = built.method === "detailed" || built.method === "short" ? "dat" : "doc";
    zip.file(`Movein.${ext}`, built.data);
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    const s3Key = `movein/${params.businessEntityId}/${runId}.zip`;
    await uploadFile(zipBuffer, s3Key, "application/zip");

    await db.insert(moveinExports).values({
      businessEntityId: params.businessEntityId,
      runId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      requestedByUserId: params.actorUserId,
      status: validation.valid ? "DONE" : "FAILED",
      movementCount: built.movementCount,
      invoiceCount: rows.length,
      s3KeyZip: s3Key,
      validationErrors: validation.valid ? null : validation.errors,
      errorMessage: validation.valid
        ? null
        : `MOVEIN validation failed (${validation.errors.length} errors)`,
    });

    if (!validation.valid) {
      return {
        error: `Export built but failed validation (${validation.errors.length} errors). Download disabled.`,
      };
    }

    return {
      runId,
      movementCount: built.movementCount,
      invoiceCount: rows.length,
    };
  } catch (err) {
    await db.insert(moveinExports).values({
      businessEntityId: params.businessEntityId,
      runId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      requestedByUserId: params.actorUserId,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : "Export failed",
    });
    return {
      error: err instanceof Error ? err.message : "Export failed",
    };
  }
}
