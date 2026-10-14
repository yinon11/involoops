import {
  getInvoices,
  getInvoiceCount,
  getPendingInvoiceOneBasedPage,
} from "@/features/expenses/actions/invoice-actions";
import { getVendors } from "@/features/expenses/actions/vendor-actions";
import { ApprovalQueue } from "@/features/expenses/components/approval/approval-queue";
import { PendingPagination } from "@/features/expenses/components/pending/pending-pagination";
import {
  PendingVendorFilter,
  PENDING_VENDOR_QUERY_UNLINKED,
} from "@/features/expenses/components/pending/pending-vendor-filter";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { redirect } from "next/navigation";
import { getDictionary } from "@/lib/i18n/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureCapOrNotFound } from "@/lib/team/enforce";

const PENDING_PAGE_SIZE = 20;

function pendingSearchQuery(parts: {
  page: number;
  invoice?: string;
  /** `vendor` query: uuid, `unlinked`, or omit for all */
  vendor?: string | null;
}) {
  const p = new URLSearchParams();
  p.set("page", String(parts.page));
  if (parts.invoice) {
    p.set("invoice", parts.invoice);
  }
  if (parts.vendor) {
    p.set("vendor", parts.vendor);
  }
  return p.toString();
}

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ invoice?: string; page?: string; vendor?: string }>;
}) {
  await ensureCapOrNotFound("view_invoices");
  const sp = await searchParams;
  const highlightInvoiceId =
    typeof sp.invoice === "string" && sp.invoice.length > 0
      ? sp.invoice
      : undefined;
  const rawPage = typeof sp.page === "string" ? sp.page : undefined;
  let requestedPage = rawPage != null ? parseInt(rawPage, 10) : 1;
  if (!Number.isFinite(requestedPage) || requestedPage < 1) {
    requestedPage = 1;
  }

  const rawVendor =
    typeof sp.vendor === "string" && sp.vendor.length > 0 ? sp.vendor : null;

  const vendorRows = await getVendors();
  const unlinkedOnly = rawVendor === PENDING_VENDOR_QUERY_UNLINKED;
  const vendorIdFilter =
    unlinkedOnly || rawVendor == null
      ? null
      : vendorRows.some((v) => v.id === rawVendor)
        ? rawVendor
        : null;

  /** Value echoed in `vendor` query (uuid or unlinked); null = show all */
  const vendorQueryParam = unlinkedOnly
    ? PENDING_VENDOR_QUERY_UNLINKED
    : vendorIdFilter;

  const pendingFilter = {
    status: "pending" as const,
    ...(unlinkedOnly ? { unlinkedVendorOnly: true as const } : {}),
    ...(vendorIdFilter ? { vendorId: vendorIdFilter } : {}),
  };

  const totalPending = await getInvoiceCount(pendingFilter);

  const totalPages =
    totalPending === 0 ? 1 : Math.ceil(totalPending / PENDING_PAGE_SIZE);

  if (highlightInvoiceId) {
    const correctPage = await getPendingInvoiceOneBasedPage(
      highlightInvoiceId,
      PENDING_PAGE_SIZE,
      vendorIdFilter,
      unlinkedOnly,
    );
    if (correctPage != null && correctPage !== requestedPage) {
      redirect(
        `/pending?${pendingSearchQuery({
          page: correctPage,
          invoice: highlightInvoiceId,
          vendor: vendorQueryParam,
        })}`,
      );
    }
  }

  if (requestedPage > totalPages) {
    redirect(
      `/pending?${pendingSearchQuery({
        page: totalPages,
        invoice: highlightInvoiceId,
        vendor: vendorQueryParam,
      })}`,
    );
  }

  const page = requestedPage;

  const pendingInvoices = await getInvoices({
    ...pendingFilter,
    limit: PENDING_PAGE_SIZE,
    offset: (page - 1) * PENDING_PAGE_SIZE,
  });

  const vendors = vendorRows.map((v) => ({
    id: v.id,
    name: v.name,
    isIncomeSource: v.isIncomeSource ?? false,
    autoApprove: v.autoApprove ?? false,
  }));

  const session = await auth();
  const userId = session?.user?.id;
  const suppressAutoApprovePrompt = userId
    ? await db
        .select({ value: users.suppressAutoApprovePrompt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then((rows) => rows[0]?.value ?? false)
    : false;

  const vendorOptions = vendorRows.map((v) => ({ id: v.id, name: v.name }));

  const mapped = pendingInvoices.map((inv) => ({
    id: inv.id,
    vendorId: inv.vendorId,
    suggestedVendorName: inv.suggestedVendorName,
    vendorName: inv.vendorName,
    type: inv.type,
    status: inv.status,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    amount: inv.amount,
    currency: inv.currency,
    vatAmount: inv.vatAmount,
    amountWithoutVat: inv.amountWithoutVat,
    description: inv.description,
    fileUrl: inv.fileUrl,
    fileName: inv.fileName,
    pageCount: inv.pageCount,
    extractionConfidence: inv.extractionConfidence,
    extractionMethod: inv.extractionMethod,
    createdAt: inv.createdAt,
  }));

  const filterActive = Boolean(vendorQueryParam);
  const dict = await getDictionary();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 shrink-0 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {dict.pending.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {dict.pending.subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <PendingVendorFilter
            vendors={vendorOptions}
            selectedVendorParam={vendorQueryParam}
          />
          <Badge variant="secondary" className="text-lg tabular-nums">
            {totalPending}
          </Badge>
        </div>
      </div>

      <ApprovalQueue
        invoices={mapped}
        vendors={vendors}
        highlightInvoiceId={highlightInvoiceId}
        filteredEmpty={filterActive && totalPending === 0}
        suppressAutoApprovePrompt={suppressAutoApprovePrompt}
        regeneratePendingFilter={
          unlinkedOnly
            ? { unlinkedVendorOnly: true }
            : vendorIdFilter
              ? { vendorId: vendorIdFilter }
              : undefined
        }
      />

      <PendingPagination
        page={page}
        totalPages={totalPages}
        totalCount={totalPending}
        pageSize={PENDING_PAGE_SIZE}
        vendorParam={vendorQueryParam}
      />
    </div>
  );
}
