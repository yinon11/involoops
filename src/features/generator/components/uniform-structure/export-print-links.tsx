"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { uniformStructurePrintHref } from "@/lib/uniform-structure/urls";
import { FileText } from "lucide-react";

export function ExportPrintLinks({
  runId,
  section26Label,
  appendix54Label,
}: {
  runId: string;
  section26Label: string;
  appendix54Label: string;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" asChild>
        <Link
          href={uniformStructurePrintHref(runId, "section-26")}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText className="h-3.5 w-3.5" />
          {section26Label}
        </Link>
      </Button>
      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" asChild>
        <Link
          href={uniformStructurePrintHref(runId, "appendix-54")}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText className="h-3.5 w-3.5" />
          {appendix54Label}
        </Link>
      </Button>
    </div>
  );
}
