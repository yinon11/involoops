"use server";

import { db } from "@/db";
import { invoices, vendors } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, gte, lte, like, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { getDictionary } from "@/lib/i18n/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
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
  const dict = await getDictionary();
  const unknownVendorLabel: string = dict.invoices.unknownVendor;

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

  return rows.map((r) => mapExportRow(r, unknownVendorLabel));
}

function mapExportRow(
  r: {
    invoiceNumber: string | null;
    invoiceDate: string | null;
    vendorName: string | null;
    type: string | null;
    status: string | null;
    amount: string | null;
    currency: string | null;
    vatAmount: string | null;
    amountWithoutVat: string | null;
    description: string | null;
    addedMonth: string | null;
  },
  unknownVendorLabel: string
) {
  const typeLabels: Record<string, string> = {
    expense: "Expense",
    income: "Income",
  };
  const statusLabels: Record<string, string> = {
    approved: "Approved",
    rejected: "Rejected",
    pending: "Pending",
    processing: "Processing",
  };
  return {
    "Invoice #": r.invoiceNumber ?? "",
    "Date": r.invoiceDate ?? "",
    "Vendor": r.vendorName ?? unknownVendorLabel,
    "Type": r.type ? (typeLabels[r.type] ?? r.type) : "Expense",
    "Status": r.status ? (statusLabels[r.status] ?? r.status) : "",
    "Amount": r.amount ? parseFloat(r.amount) : 0,
    "Currency": r.currency ?? "ILS",
    "VAT": r.vatAmount ? parseFloat(r.vatAmount) : 0,
    "Amount (ex-VAT)": r.amountWithoutVat ? parseFloat(r.amountWithoutVat) : 0,
    "Description": r.description ?? "",
    "Month": r.addedMonth ?? "",
  };
}

// ---------------------------------------------------------------------------
// exportInvoicesXlsx
// ---------------------------------------------------------------------------

export async function exportInvoicesXlsx(
  filters: ExportFilters = {}
): Promise<string> {
  const data = await getExportData(filters);

  if (data.length === 0) {
    throw new Error("No invoices match the selected filters.");
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
  return Buffer.from(buffer).toString("base64");
}
