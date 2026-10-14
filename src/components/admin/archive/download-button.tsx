"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getArchiveDownloadUrl } from "@/features/generator/actions/archive-actions";
import { useI18n } from "@/lib/i18n/client";
import { Download } from "lucide-react";
import type { ArchiveObjectKind } from "@/db/schema/archive-objects";

export function ArchiveDownloadButton({
  documentId,
  objectKind,
}: {
  documentId: string;
  objectKind: ArchiveObjectKind;
}) {
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const { url } = await getArchiveDownloadUrl({
          documentId,
          objectKind,
        });
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        alert(err instanceof Error ? err.message : "Download failed");
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={run}
      disabled={isPending}
      className="gap-1 text-xs"
    >
      <Download className="h-3.5 w-3.5" />
      {dict.archive.action.download}
    </Button>
  );
}
