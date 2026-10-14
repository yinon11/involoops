"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestMoveinExport } from "@/features/generator/actions/movein-export-actions";
import { OpenAllocationNotice } from "@/features/generator/components/outbound/open-allocation-notice";
import type { OpenAllocationDraft } from "@/lib/outbound/open-allocation-drafts";
import { useI18n } from "@/lib/i18n/client";
import { FileDown, Loader2 } from "lucide-react";

function lastCalendarMonthRange(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function MoveinExportForm({
  settingsComplete,
}: {
  settingsComplete: boolean;
}) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.hashavshevet;
  const defaultRange = lastCalendarMonthRange();

  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(defaultRange.end);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string; downloadHref?: string } | null
  >(null);
  const [openDrafts, setOpenDrafts] = useState<OpenAllocationDraft[]>([]);

  function submit() {
    setMessage(null);
    setOpenDrafts([]);
    startTransition(async () => {
      const res = await requestMoveinExport({ periodStart, periodEnd });
      if ("error" in res) {
        setOpenDrafts(res.openDrafts ?? []);
        setMessage({ kind: "error", text: res.error });
        return;
      }
      setOpenDrafts(res.openDrafts);
      const downloadHref = `/api/files/movein/${encodeURIComponent(res.runId)}`;
      setMessage({
        kind: "ok",
        text: t.exportQueued
          .replace("{invoices}", String(res.invoiceCount))
          .replace("{movements}", String(res.movementCount)),
        downloadHref,
      });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.exportTitle}</CardTitle>
        <p className="text-sm text-zinc-600">{t.exportExplain}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!settingsComplete && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t.settingsIncomplete}{" "}
            <Link
              href="/outbound/hashavshevet"
              className="font-medium underline underline-offset-2"
            >
              {t.tabs.settings}
            </Link>
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">{t.periodStart}</Label>
            <Input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t.periodEnd}</Label>
            <Input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={submit}
              disabled={isPending || !settingsComplete}
              className="w-full gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
              {t.generate}
            </Button>
          </div>
        </div>

        {message && (
          <div
            className={
              message.kind === "error"
                ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                : "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900"
            }
            role="status"
          >
            <p>{message.text}</p>
            {message.downloadHref && (
              <a
                href={message.downloadHref}
                className="mt-2 inline-flex font-medium underline underline-offset-2"
              >
                {t.download}
              </a>
            )}
          </div>
        )}

        <OpenAllocationNotice items={openDrafts} />

        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
          {t.importHint}
        </p>
      </CardContent>
    </Card>
  );
}
