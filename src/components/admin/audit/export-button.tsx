"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { exportAuditEntriesJson } from "@/actions/audit-actions";
import { Download } from "lucide-react";
import type { AuditEventType } from "@/db/schema";

interface Filters {
  userId?: string;
  documentId?: string;
  eventTypes?: AuditEventType[];
  from?: string;
  to?: string;
}

export function AuditExportButton({ filters }: { filters: Filters }) {
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const json = await exportAuditEntriesJson({
          userId: filters.userId,
          documentId: filters.documentId,
          eventTypes: filters.eventTypes,
          from: filters.from,
          to: filters.to,
        });
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        a.download = `audit-export-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Export failed");
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={isPending}
      className="gap-2"
    >
      <Download className="h-4 w-4" />
      Export JSON
    </Button>
  );
}
