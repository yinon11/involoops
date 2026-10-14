import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";
import type { OutboundPaymentEntry } from "@/db/schema/outbound-invoices";

export interface ReceiptHistoryEntry {
  receiptId: string;
  formattedNumber: string | null;
  invoiceDate: string;
  total: string;
  status: OutboundInvoiceStatus;
  payments: OutboundPaymentEntry[];
}

interface Props {
  entries: ReceiptHistoryEntry[];
  outstandingAmount: string;
  originalTotal: string;
  currency: string;
}

/**
 * Parent-side ledger of every receipt (`RECEIPT` document referencing
 * this tax invoice via `references_document_id`). Mirrors the layout
 * of `CreditHistoryCard`. Voided / draft receipts are still listed but
 * tagged so the seller can audit attempts that didn't settle the
 * balance.
 */
export async function ReceiptHistoryCard({
  entries,
  outstandingAmount,
  originalTotal,
  currency,
}: Props) {
  const dict = await getDictionary();
  const fullyPaid = Number(outstandingAmount) <= 0;
  const t = dict.outbound.receiptForInvoice.history;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-gray-50 p-3 text-sm">
          {fullyPaid ? (
            <Badge className="bg-emerald-100 text-emerald-800">
              {t.fullyPaid}
            </Badge>
          ) : entries.filter((e) => e.status !== "voided" && e.status !== "draft")
              .length === 0 ? (
            <span className="text-gray-500">{t.empty}</span>
          ) : (
            <span>
              {format(t.partial, {
                amount: `${outstandingAmount} ${currency}`,
              })}
              <span className="ms-2 text-gray-500">
                / {originalTotal} {currency}
              </span>
            </span>
          )}
        </div>

        {entries.length > 0 && (
          <ul className="divide-y">
            {entries.map((entry) => {
              const isInactive =
                entry.status === "voided" || entry.status === "draft";
              const methodSummary =
                entry.payments.length > 0
                  ? entry.payments
                      .map((p) =>
                        dict.outbound.receiptForInvoice.history.method[p.method],
                      )
                      .join(", ")
                  : "—";
              return (
                <li
                  key={entry.receiptId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge
                      variant="secondary"
                      className={
                        isInactive
                          ? "bg-gray-100 text-gray-600"
                          : "bg-emerald-50 text-emerald-800"
                      }
                    >
                      {dict.outbound.status[entry.status]}
                    </Badge>
                    {entry.formattedNumber ? (
                      <Link
                        href={`/outbound/${entry.receiptId}`}
                        className="font-mono font-medium hover:underline"
                      >
                        {entry.formattedNumber}
                      </Link>
                    ) : (
                      <Link
                        href={`/outbound/${entry.receiptId}`}
                        className="font-mono font-medium text-gray-500 hover:underline"
                      >
                        {t.draftLabel}
                      </Link>
                    )}
                    <span className="text-xs text-gray-500">
                      {entry.invoiceDate}
                    </span>
                    <span className="text-xs text-gray-500">
                      {methodSummary}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`font-semibold ${
                        isInactive ? "text-gray-500" : "text-emerald-800"
                      }`}
                    >
                      {isInactive ? "" : "+"}
                      {entry.total} {currency}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
