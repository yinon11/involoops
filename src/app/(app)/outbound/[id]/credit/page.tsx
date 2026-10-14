import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getOutboundInvoiceById } from "@/features/generator/actions/outbound-invoice-actions";
import { db } from "@/db";
import { documentLinks, outboundInvoices } from "@/db/schema";
import { CreditNoteForm } from "@/features/generator/components/outbound/credit-note-form";

export const metadata = {
  title: "Issue credit note",
  robots: { index: false, follow: false },
};

export default async function IssueCreditNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireGeneratorAccess();

  const { id } = await params;
  const data = await getOutboundInvoiceById(id);
  if (!data) notFound();

  // Credit notes can only originate from tax invoices in
  // issued/sent/paid state with remaining balance. Fall back to
  // `total` when `netOfCreditsAmount` is null (legacy rows that
  // pre-date spec 11.2 — creation now seeds this column for new rows).
  const remaining = Number(data.netOfCreditsAmount ?? data.total);
  if (
    (data.documentType !== "TAX_INVOICE" &&
      data.documentType !== "TAX_INVOICE_RECEIPT") ||
    !["issued", "sent", "paid"].includes(data.status ?? "") ||
    remaining <= 0 ||
    // Issued documents always carry a fiscal number per the
    // `outbound_invoices_issued_has_number` CHECK; this guard is
    // defensive narrowing for the now-nullable column type.
    data.formattedNumber == null
  ) {
    notFound();
  }
  const originalFormattedNumber = data.formattedNumber;

  const existingCredits = await db
    .select({
      amount: documentLinks.amount,
      formattedNumber: outboundInvoices.formattedNumber,
    })
    .from(documentLinks)
    .innerJoin(
      outboundInvoices,
      eq(documentLinks.fromDocumentId, outboundInvoices.id),
    )
    .where(
      and(
        eq(documentLinks.toDocumentId, data.id),
        inArray(documentLinks.linkType, ["CREDIT_REVERSES", "CREDIT_PARTIAL"]),
      ),
    );

  return (
    <div className="py-4">
      <CreditNoteForm
        originalInvoiceId={data.id}
        originalFormattedNumber={originalFormattedNumber}
        originalCustomerName={data.customer?.name ?? null}
        originalGrandTotal={String(data.total)}
        remainingAmount={remaining.toFixed(2)}
        vatRate={String(data.vatRate ?? "0")}
        currency={data.currency ?? "ILS"}
        originalAllocationNumber={data.allocationNumber ?? null}
        existingCredits={existingCredits.map((c) => ({
          amount: c.amount ?? "0.00",
          // Existing credit notes are issued by definition; the schema
          // makes the column nullable but rows here always carry a value.
          formattedNumber: c.formattedNumber ?? "",
        }))}
      />
    </div>
  );
}
