"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initialBusinessEntityId: string;
  initialDocumentId: string;
  initialFrom: string;
  initialTo: string;
}

export function ArchiveFilters({
  initialBusinessEntityId,
  initialDocumentId,
  initialFrom,
  initialTo,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [businessEntityId, setBusinessEntityId] = useState(
    initialBusinessEntityId,
  );
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  function apply() {
    const params = new URLSearchParams();
    if (businessEntityId.trim())
      params.set("businessEntityId", businessEntityId.trim());
    if (documentId.trim()) params.set("documentId", documentId.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    startTransition(() => router.push(`/admin/archive?${params.toString()}`));
  }

  function reset() {
    setBusinessEntityId("");
    setDocumentId("");
    setFrom("");
    setTo("");
    startTransition(() => router.push("/admin/archive"));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Business Entity ID</Label>
          <Input
            value={businessEntityId}
            onChange={(e) => setBusinessEntityId(e.target.value)}
            placeholder="uuid…"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Document ID</Label>
          <Input
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            placeholder="uuid…"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={apply} disabled={isPending}>
          Apply
        </Button>
        <Button variant="outline" onClick={reset} disabled={isPending}>
          Reset
        </Button>
      </div>
    </div>
  );
}
