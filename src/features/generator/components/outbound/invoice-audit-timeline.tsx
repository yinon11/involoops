"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AuditListRow } from "@/actions/audit-actions";
import { auditEventDisplayLabel } from "@/lib/audit/event-label";
import { useI18n } from "@/lib/i18n/client";

interface Props {
  entries: AuditListRow[];
}

export function InvoiceAuditTimeline({ entries }: Props) {
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            History ({entries.length})
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            className="gap-1"
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {open ? "Hide" : "Show"}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-500">
              No audit entries for this document.
            </p>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-xs text-gray-500">
                        #{entry.sequenceNumber}
                      </span>
                      <Badge
                        variant="secondary"
                        className="bg-indigo-50 text-indigo-700"
                      >
                        {auditEventDisplayLabel(
                          entry.eventType,
                          entry.eventPayload,
                          dict.audit,
                        )}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {entry.createdAt
                          .toISOString()
                          .replace("T", " ")
                          .slice(0, 19)}
                      </span>
                      <span className="text-xs text-gray-500">
                        by {entry.actorEmail ?? "[deleted user]"}
                      </span>
                    </div>
                    <span
                      className="font-mono text-[11px] text-gray-400"
                      title={entry.entryHash}
                    >
                      {entry.entryHashShort}…
                    </span>
                  </div>
                  <details className="mt-2 text-xs text-gray-600">
                    <summary className="cursor-pointer">payload</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-[11px]">
                      {JSON.stringify(entry.eventPayload, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}
