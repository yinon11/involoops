"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { testShaamConnection } from "@/actions/shaam-actions";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";
import { Loader2, Plug, CheckCircle2, XCircle } from "lucide-react";

interface Props {
  businessEntityId: string;
  environment: ShaamEnvironment;
  label: string;
}

export function ShaamTestConnectionButton({
  businessEntityId,
  environment,
  label,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "fail"; text: string } | null
  >(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const res = await testShaamConnection({ businessEntityId, environment });
      if (res.ok) {
        setMessage({ kind: "ok", text: `Token active (${res.accessTokenPrefix})` });
      } else {
        setMessage({
          kind: "fail",
          text: res.detail ? `${res.reason} — ${res.detail}` : res.reason,
        });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
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
          <Plug className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {message && (
        <span
          className={
            "flex items-center gap-1 text-[11px] " +
            (message.kind === "ok" ? "text-green-700" : "text-red-700")
          }
          title={message.text}
        >
          {message.kind === "ok" ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {message.text}
        </span>
      )}
    </div>
  );
}
