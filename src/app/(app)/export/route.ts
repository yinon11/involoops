import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { invoices, vendors } from "@/db/schema";
import { eq, and, gte, lte, like, desc, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { downloadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import { safeBasename } from "@/lib/zip-invoice-candidates";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const searchParams = request.nextUrl.searchParams;

  // Parse filters
  const status = searchParams.get("status") as
    | "processing"
    | "pending"
    | "approved"
    | "rejected"
    | null;
  const vendorId = searchParams.get("vendorId");
  const type = searchParams.get("type") as "expense" | "income" | null;
  const yearRaw = searchParams.get("year");
  const monthRaw = searchParams.get("month");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const search = searchParams.get("search");

  // Strictly validate year/month — reject anything that isn't a plain integer in range.
  const year = yearRaw != null ? parseStrictInt(yearRaw, 1900, 2999) : null;
  const month = monthRaw != null ? parseStrictInt(monthRaw, 1, 12) : null;
  if (yearRaw != null && year === null) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }
  if (monthRaw != null && month === null) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  // Build conditions
  const conditions: ReturnType<typeof eq>[] = [eq(invoices.userId, userId)];

  if (status) conditions.push(eq(invoices.status, status));
  if (vendorId) conditions.push(eq(invoices.vendorId, vendorId));
  if (type) conditions.push(eq(invoices.type, type));
  if (year !== null) {
    conditions.push(
      sql`extract(year from ${invoices.invoiceDate}::date) = ${year}`
    );
  }
  if (month !== null) {
    conditions.push(
      sql`extract(month from ${invoices.invoiceDate}::date) = ${month}`
    );
  }
  if (dateFrom) conditions.push(gte(invoices.invoiceDate, dateFrom));
  if (dateTo) conditions.push(lte(invoices.invoiceDate, dateTo));
  if (search)
    conditions.push(like(invoices.invoiceNumber, `%${search}%`));

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
      fileUrl: invoices.fileUrl,
      fileName: invoices.fileName,
    })
    .from(invoices)
    .leftJoin(vendors, eq(invoices.vendorId, vendors.id))
    .where(and(...conditions))
    .orderBy(desc(invoices.invoiceDate));

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No invoices found matching the given filters." },
      { status: 404 }
    );
  }

  // Generate XLSX
  const excelData = rows.map((r) => ({
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

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const colWidths = Object.keys(excelData[0]).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...excelData.map(
        (row) =>
          String((row as Record<string, unknown>)[key] ?? "").length
      )
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });
  worksheet["!cols"] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
  const xlsxBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  // Bundle into ZIP
  const zip = new JSZip();
  zip.file("invoices.xlsx", xlsxBuffer);

  // Attempt to include PDF files — SSRF-safe: resolve to an S3 key we own and
  // fetch via the S3 client instead of `fetch(row.fileUrl)`, which could target
  // arbitrary URLs (internal services, cloud metadata, localhost) if the DB
  // ever holds a non-S3 URL.
  for (const row of rows) {
    if (!row.fileUrl || !row.fileName) continue;
    const key = resolveStorageKeyFromFileUrl(row.fileUrl);
    // Defense in depth: keys must be scoped to this user's prefix.
    if (!key || !key.startsWith(`${userId}/`)) continue;
    try {
      const buffer = await downloadFile(key);
      // Sanitize filename — it came from user input originally.
      zip.file(`files/${safeBasename(row.fileName)}`, buffer);
    } catch {
      // Skip files that can't be downloaded
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="invoices-export.zip"',
    },
  });
}

/** Parse a decimal integer in [min, max] or return null. Avoids parseInt coercion quirks. */
function parseStrictInt(
  raw: string,
  min: number,
  max: number
): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}
