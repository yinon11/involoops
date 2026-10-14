"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuditEventType } from "@/db/schema";

interface AuditFiltersProps {
  initialUserId: string;
  initialBusinessEntityId: string;
  initialDocumentId: string;
  initialFrom: string;
  initialTo: string;
  initialEventTypes: AuditEventType[];
  allEventTypes: readonly AuditEventType[];
  eventLabels: Record<AuditEventType, string>;
}

export function AuditFilters({
  initialUserId,
  initialBusinessEntityId,
  initialDocumentId,
  initialFrom,
  initialTo,
  initialEventTypes,
  allEventTypes,
  eventLabels,
}: AuditFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [userId, setUserId] = useState(initialUserId);
  const [businessEntityId, setBusinessEntityId] = useState(
    initialBusinessEntityId,
  );
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [selected, setSelected] = useState<Set<AuditEventType>>(
    new Set(initialEventTypes),
  );

  function toggle(event: AuditEventType) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  function apply() {
    const params = new URLSearchParams();
    if (userId.trim()) params.set("userId", userId.trim());
    if (businessEntityId.trim())
      params.set("businessEntityId", businessEntityId.trim());
    if (documentId.trim()) params.set("documentId", documentId.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    for (const evt of selected) params.append("eventType", evt);
    startTransition(() => {
      router.push(`/admin/audit?${params.toString()}`);
    });
  }

  function reset() {
    setUserId("");
    setBusinessEntityId("");
    setDocumentId("");
    setFrom("");
    setTo("");
    setSelected(new Set());
    startTransition(() => router.push("/admin/audit"));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label className="text-xs">User ID</Label>
          <Input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="uuid…"
          />
        </div>
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

      <div>
        <Label className="text-xs">Event types</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {allEventTypes.map((evt) => {
            const on = selected.has(evt);
            return (
              <button
                key={evt}
                type="button"
                onClick={() => toggle(evt)}
                className={
                  "rounded-full border px-3 py-1 text-xs transition-colors " +
                  (on
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-600 hover:border-gray-400")
                }
              >
                {eventLabels[evt] ?? evt}
              </button>
            );
          })}
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
