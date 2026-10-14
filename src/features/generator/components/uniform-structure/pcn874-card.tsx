"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import { OpenAllocationNotice } from "@/features/generator/components/outbound/open-allocation-notice";
import type { OpenAllocationDraft } from "@/lib/outbound/open-allocation-drafts";

interface Summary {
  totals: {
    taxableSales: number;
    taxableVat: number;
    zeroOrExemptSales: number;
    salesRecords: number;
    vatToPay: number;
  };
  notes: Array<{ formattedNumber: string; kind: "no_customer_number" | "allocation_pending" }>;
  openDrafts: OpenAllocationDraft[];
}

/** The calendar month before this one — the default the ITA describes. */
function previousMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/**
 * PCN874, sales side: pick a month, see the header totals the file will
 * carry and anything worth checking, then download PCN874.TXT.
 */
export function Pcn874Card() {
  const { dict } = useI18n();
  const t = dict.uniformStructure.pcn874;
  const [month, setMonth] = useState(previousMonth);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const url = (json: boolean) =>
    `/api/files/pcn874?month=${encodeURIComponent(month)}${json ? "&format=json" : ""}`;

  function check() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const res = await fetch(url(true), { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? t.failed);
        return;
      }
      setSummary(body as Summary);
    });
  }

  const ils = (n: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t.intro}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="pcn874-month">{t.month}</Label>
            <Input
              id="pcn874-month"
              type="month"
              dir="ltr"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSummary(null);
              }}
            />
          </div>
          <Button variant="outline" onClick={check} disabled={isPending || !month}>
            {isPending ? t.checking : t.check}
          </Button>
          {summary && (
            <Button asChild>
              <a href={url(false)} download="PCN874.TXT">
                {t.download}
              </a>
            </Button>
          )}
        </div>

        {error && <p className="rounded-md bg-red-50 p-2 text-red-700">{error}</p>}

        {summary && (
          <div className="space-y-3">
            <OpenAllocationNotice items={summary.openDrafts ?? []} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              <dt className="text-muted-foreground">{t.records}</dt>
              <dd>{summary.totals.salesRecords}</dd>
              <dt className="text-muted-foreground">{t.taxableSales}</dt>
              <dd dir="ltr">₪{ils(summary.totals.taxableSales)}</dd>
              <dt className="text-muted-foreground">{t.taxableVat}</dt>
              <dd dir="ltr">₪{ils(summary.totals.taxableVat)}</dd>
              <dt className="text-muted-foreground">{t.zeroOrExempt}</dt>
              <dd dir="ltr">₪{ils(summary.totals.zeroOrExemptSales)}</dd>
              <dt className="text-muted-foreground">{t.vatToPay}</dt>
              <dd dir="ltr">₪{ils(summary.totals.vatToPay)}</dd>
            </dl>
            {summary.notes.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md bg-amber-50 p-3 ps-6 text-amber-900">
                {summary.notes.map((n) => (
                  <li key={`${n.formattedNumber}-${n.kind}`}>
                    {format(t.notes[n.kind], { number: n.formattedNumber })}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t.inputsNote}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
