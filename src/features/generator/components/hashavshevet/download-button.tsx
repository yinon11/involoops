"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function MoveinDownloadButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Button variant="outline" size="sm" className="gap-2" asChild>
      <a href={href}>
        <Download className="h-3.5 w-3.5" />
        {label}
      </a>
    </Button>
  );
}
