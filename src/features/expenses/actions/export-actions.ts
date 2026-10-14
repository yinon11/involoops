"use server";

import { db } from "@/db";
import { invoices, vendors } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, gte, lte, like, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import type { ActionResultWith } from "@/types/action-result";
import { getDictionary } from "@/lib/i18n/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

// ---------------------------------------------------------------------------
// Shared filter interface
// ---------------------------------------------------------------------------

export interface ExportFilters {
  status?: "processing" | "pending" | "approved" | "rejected";
  vendorId?: string;
  type?: "expense" | "income";
  year?: number;
  month?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// getExportData
// ---------------------------------------------------------------------------

export async function getExportData(filters: ExportFilters = {}) {
  const userId = await requireUserId();

  const conditions: ReturnType<typeof eq>[] = [eq(invoices.userId, userId)];

  if (filters.status) {
    conditions.push(eq(invoices.status, filters.status));
  }
  if (filters.vendorId) {
    conditions.push(eq(invoices.vendorId, filters.vendorId));
  }
  if (filters.type) {
    conditions.push(eq(invoices.type, filters.type));
  }
  if (filters.year) {
    conditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${filters.year}`
    );
  }
  if (filters.month) {
    conditions.push(
      sql`extract(month from ${invoices.invoiceDate}::date) = ${filters.month}`
    );
  }
  if (filters.dateFrom) {
    conditions.push(gte(invoices.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(invoices.invoiceDate, filters.dateTo));
  }
  if (filters.search) {
    conditions.push(like(invoices.invoiceNumber, `%${filters.search}%`));
  }

  const rows = await db
    .select({
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      vendorName: vendors.name,
      type: invoices.type,
      status: invoices.status,
      amount: invoices.amount,
      currency: invoices.currency,
      vatAmount: invoices.vatAmount,
      amountWithoutVat: invoices.amountWithoutVat,
      description: invoices.description,
      addedMonth: invoices.addedMonth,
    })
    .from(invoices)
    .leftJoin(vendors, eq(invoices.vendorId, vendors.id))
    .where(and(...conditions))
    .orderBy(desc(invoices.invoiceDate));

  return rows.map((r) => ({
    "Invoice Number": r.invoiceNumber ?? "",
    "Invoice Date": r.invoiceDate ?? "",
    Vendor: r.vendorName ?? "Unknown",
    Type: r.type ?? "expense",
    Status: r.status ?? "",
    Amount: r.amount ? parseFloat(r.amount) : 0,
    Currency: r.currency ?? "ILS",
    "VAT Amount": r.vatAmount ? parseFloat(r.vatAmount) : 0,
    "Amount Without VAT": r.amountWithoutVat
      ? parseFloat(r.amountWithoutVat)
      : 0,
    Description: r.description ?? "",
    "Uploaded Month": r.addedMonth ?? "",
  }));
}

// ---------------------------------------------------------------------------
// exportInvoicesXlsx
// ---------------------------------------------------------------------------

export async function exportInvoicesXlsx(
  filters: ExportFilters = {}
): Promise<ActionResultWith<{ base64: string }>> {
  const dict = await getDictionary();
  const data = await getExportData(filters);

  if (data.length === 0) {
    return {
      success: false,
      error: dict.errors.noInvoicesMatchFilters,
    };
  }

  const worksheet = XLSX.utils.json_to_sheet(data);

  // Auto-size columns
  const colWidths = Object.keys(data[0]).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...data.map((row) => String((row as Record<string, unknown>)[key] ?? "").length)
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });
  worksheet["!cols"] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return { success: true, base64: Buffer.from(buffer).toString("base64") };
}
