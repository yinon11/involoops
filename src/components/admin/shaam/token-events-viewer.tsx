"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  listShaamTokenEvents,
  type ShaamTokenEventRow,
} from "@/actions/shaam-actions";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";
import { useI18n } from "@/lib/i18n/client";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface Props {
  businessEntityId: string;
  environment: ShaamEnvironment;
}

export function ShaamTokenEventsViewer({
  businessEntityId,
  environment,
}: Props) {
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ShaamTokenEventRow[] | null>(null);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (rows === null) {
      startTransition(async () => {
        const data = await listShaamTokenEvents({
          businessEntityId,
          environment,
        });
        setRows(data);
      });
    }
  }

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        className="gap-1 text-xs"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        View events
      </Button>
      {open && (
        <div className="mt-2 rounded-md border bg-gray-50 p-2 text-xs">
          {isPending ? (
            <div className="flex items-center gap-1 text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : rows && rows.length > 0 ? (
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-gray-500">
                    {r.createdAt.replace("T", " ").slice(0, 19)}
                  </span>
                  <span className="font-medium">
                    {dict.shaam.events[r.eventType] ?? r.eventType}
                  </span>
                  {r.httpStatus !== null && (
                    <span className="font-mono">{r.httpStatus}</span>
                  )}
                  {r.errorCode && (
                    <span className="text-red-700">{r.errorCode}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No events.</p>
          )}
        </div>
      )}
    </div>
  );
}
