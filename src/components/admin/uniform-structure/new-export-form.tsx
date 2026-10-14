"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestUniformStructureExport } from "@/features/generator/actions/uniform-structure-actions";
import { OpenAllocationNotice } from "@/features/generator/components/outbound/open-allocation-notice";
import type { OpenAllocationDraft } from "@/lib/outbound/open-allocation-drafts";
import { useI18n } from "@/lib/i18n/client";
import { FileDown, Loader2 } from "lucide-react";

export function NewExportForm() {
  const router = useRouter();
  const { dict } = useI18n();
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "info" | "error"; text: string } | null
  >(null);
  const [openDrafts, setOpenDrafts] = useState<OpenAllocationDraft[]>([]);

  function submit() {
    setMessage(null);
    setOpenDrafts([]);
    startTransition(async () => {
      try {
        const res = await requestUniformStructureExport({
          periodStart,
          periodEnd,
        });
        if ("error" in res) {
          setMessage({ kind: "error", text: res.error });
          return;
        }
        setOpenDrafts(res.openDrafts);
        setMessage({
          kind: "info",
          text: res.alreadyRunning
            ? `Already running: ${res.runId}`
            : `Queued: ${res.runId} (est. ${res.estimatedSeconds}s)`,
        });
        router.refresh();
      } catch (err) {
        setMessage({
          kind: "error",
          text: err instanceof Error ? err.message : "Export request failed",
        });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {dict.uniformStructure.title}
        </CardTitle>
        <p className="text-sm text-gray-600">
          {dict.uniformStructure.explain}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">{dict.uniformStructure.periodStart}</Label>
            <Input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{dict.uniformStructure.periodEnd}</Label>
            <Input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={submit}
              disabled={isPending}
              className="gap-2 w-full"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
              {dict.uniformStructure.generate}
            </Button>
          </div>
        </div>
        {message && (
          <p
            className={
              message.kind === "error"
                ? "rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800"
                : "rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800"
            }
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
        <OpenAllocationNotice items={openDrafts} />
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {dict.uniformStructure.simulatorHint}
        </p>
      </CardContent>
    </Card>
  );
}
