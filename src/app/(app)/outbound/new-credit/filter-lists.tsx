"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Search, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { hebrewNamesClose } from "@/lib/hebrew-name-match";

type Customer = { id: string; name: string; invoiceCount: number };

export function CustomerFilterList({
  customers,
  cardTitle,
  searchPlaceholder,
  invoicesAvailableLabel,
  noMatchesLabel,
}: {
  customers: Customer[];
  cardTitle: string;
  searchPlaceholder: string;
  invoicesAvailableLabel: string;
  noMatchesLabel: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || hebrewNamesClose(c.name, q),
    );
  }, [customers, query]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          {cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="relative px-6 pt-3">
          <Search className="pointer-events-none absolute start-9 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="ps-9"
            data-voice-field="customer"
            data-highlight="credit-customer-search"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            {noMatchesLabel}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/outbound/new-credit?customerId=${c.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-slate-50"
                  data-voice-action="pick-customer"
                  data-highlight={c.name}
                >
                  <span className="font-medium text-slate-900">{c.name}</span>
                  <span className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="bg-slate-100 text-[11px] text-slate-700"
                    >
                      {c.invoiceCount} {invoicesAvailableLabel}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type Invoice = {
  id: string;
  formattedNumber: string;
  documentType: string;
  invoiceDate: string;
  total: number;
  remaining: number;
  currency: string;
  allocationNumber: string | null;
};

export function InvoiceFilterList({
  invoices,
  documentTypeLabels,
  cardTitle,
  searchPlaceholder,
  partiallyCreditedLabel,
  noMatchesLabel,
}: {
  invoices: Invoice[];
  documentTypeLabels: Record<string, string>;
  cardTitle: string;
  searchPlaceholder: string;
  partiallyCreditedLabel: string;
  noMatchesLabel: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (inv) =>
        inv.formattedNumber.toLowerCase().includes(q) ||
        (inv.allocationNumber?.toLowerCase().includes(q) ?? false),
    );
  }, [invoices, query]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          {cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="relative px-6 pt-3">
          <Search className="pointer-events-none absolute start-9 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="ps-9"
            data-voice-field="sourceInvoice"
            data-highlight="credit-invoice-search"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            {noMatchesLabel}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((inv) => {
              const fullyOutstanding = inv.total === inv.remaining;
              return (
                <li key={inv.id}>
                  <Link
                    href={`/outbound/${inv.id}/credit`}
                    className="flex items-start justify-between gap-4 px-6 py-3 hover:bg-slate-50"
                    data-voice-action="pick-invoice"
                    data-highlight={inv.formattedNumber}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-slate-900">
                          {inv.formattedNumber}
                        </span>
                        <Badge
                          variant="secondary"
                          className="bg-indigo-50 text-[11px] text-indigo-700"
                        >
                          {documentTypeLabels[inv.documentType] ??
                            inv.documentType}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{inv.invoiceDate}</span>
                        {inv.allocationNumber && (
                          <span className="font-mono">
                            #{inv.allocationNumber}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-medium tabular-nums text-slate-900">
                        {Number(inv.remaining).toLocaleString()} {inv.currency}
                      </div>
                      {!fullyOutstanding && (
                        <div className="text-[11px] text-slate-500">
                          {partiallyCreditedLabel} ·{" "}
                          {Number(inv.total).toLocaleString()} {inv.currency}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
