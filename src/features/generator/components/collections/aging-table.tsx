"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgingRow } from "@/features/generator/actions/collections-actions";

interface AgingTableLabels {
  title: string;
  subtitle: string;
  colCustomer: string;
  colInvoice: string;
  colAmount: string;
  colIssued: string;
  colDaysOut: string;
  empty: string;
  emptySub: string;
}

interface AgingTableProps {
  rows: AgingRow[];
  labels: AgingTableLabels;
}

function DaysBadge({ days }: { days: number }) {
  const cls =
    days <= 30
      ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200/60"
      : days <= 60
        ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60"
        : days <= 90
          ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200/60"
          : "bg-red-50 text-red-700 ring-1 ring-red-200/60";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}
    >
      {days}d
    </span>
  );
}

export function AgingTable({ rows, labels }: AgingTableProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">
          {labels.title}
        </CardTitle>
        <p className="text-xs text-slate-500">{labels.subtitle}</p>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-500">
              <FileText className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium text-slate-700">{labels.empty}</p>
            <p className="text-xs text-slate-400">{labels.emptySub}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {labels.colCustomer}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {labels.colInvoice}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {labels.colAmount}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {labels.colIssued}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {labels.colDaysOut}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="group transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.customerName}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/outbound/${row.id}`}
                        className="font-mono text-xs font-semibold text-violet-700 transition-colors hover:text-violet-900 hover:underline"
                      >
                        {row.formattedNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                      {Number(row.outstanding).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}{" "}
                      <span className="text-xs text-slate-400">{row.currency}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-500">
                      {row.invoiceDate}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <DaysBadge days={row.daysOutstanding} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
