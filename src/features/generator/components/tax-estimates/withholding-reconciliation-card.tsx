import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WithholdingReconciliation } from "@/features/generator/actions/tax-actions";

export interface WithholdingReconciliationLabels {
  title: string;
  subtitle: string;
  colCustomer: string;
  colReceipts: string;
  colGross: string;
  colWithheld: string;
  colReceived: string;
  totalRow: string;
  empty: string;
}

function money(amount: number, currency: string): string {
  const sym =
    currency === "ILS"
      ? "₪"
      : currency === "USD"
        ? "$"
        : currency === "EUR"
          ? "€"
          : `${currency} `;
  return `${sym}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Per-customer ניכוי מס במקור for the tax year — what to reconcile against
 * the טופס 857 each customer sends. Rendered only when the year actually
 * had withholding, so the page stays quiet for sellers who never encounter
 * it.
 */
export function WithholdingReconciliationCard({
  data,
  labels,
}: {
  data: WithholdingReconciliation;
  labels: WithholdingReconciliationLabels;
}) {
  const { currency } = data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-base font-semibold text-slate-800">
              {labels.title}
            </CardTitle>
            <p className="text-xs text-slate-500">{labels.subtitle}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {data.rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {labels.empty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 text-start">{labels.colCustomer}</th>
                  <th className="px-4 py-3 text-end">{labels.colReceipts}</th>
                  <th className="px-4 py-3 text-end">{labels.colGross}</th>
                  <th className="px-4 py-3 text-end">{labels.colWithheld}</th>
                  <th className="px-4 py-3 text-end">{labels.colReceived}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((row) => (
                  <tr key={row.customerId ?? "unlinked"} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">
                        {row.customerName}
                      </span>
                      {row.customerTaxId ? (
                        <span className="ms-2 font-mono text-xs text-slate-400">
                          {row.customerTaxId}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-600">
                      {row.receiptCount}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-600">
                      {money(row.gross, currency)}
                    </td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums text-emerald-700">
                      {money(row.withheld, currency)}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-600">
                      {money(row.received, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-slate-50 font-semibold text-slate-800">
                  <td className="px-4 py-3">{labels.totalRow}</td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {data.rows.reduce((s, r) => s + r.receiptCount, 0)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {money(data.totalGross, currency)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-emerald-700">
                    {money(data.totalWithheld, currency)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {money(data.totalReceived, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
