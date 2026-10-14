"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getExportDownloadUrl } from "@/features/generator/actions/uniform-structure-actions";
import { Download, Loader2 } from "lucide-react";

export function ExportDownloadButton({
  runId,
  label,
}: {
  runId: string;
  label: string;
}) {
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await getExportDownloadUrl(runId);
      if ("url" in res) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        alert(res.error);
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={run}
      disabled={isPending}
      className="gap-1"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );
}
