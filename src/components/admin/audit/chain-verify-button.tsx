"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { verifyBusinessEntityChain } from "@/actions/audit-actions";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { format } from "@/lib/i18n";

export function AuditChainVerifyButton({
  businessEntityId,
}: {
  businessEntityId: string;
}) {
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    | { kind: "ok"; text: string }
    | { kind: "broken"; text: string }
    | null
  >(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await verifyBusinessEntityChain(businessEntityId);
        if (result.ok) {
          setMessage({ kind: "ok", text: dict.audit.chain.verified });
        } else {
          setMessage({
            kind: "broken",
            text: format(dict.audit.chain.broken, {
              n: String(result.brokenAt),
            }),
          });
        }
      } catch (err) {
        setMessage({
          kind: "broken",
          text: err instanceof Error ? err.message : "Verification failed",
        });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={isPending}
        className="gap-2"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="h-4 w-4" />
        )}
        Verify chain
      </Button>
      {message && (
        <span
          className={
            "flex items-center gap-1 text-xs " +
            (message.kind === "ok" ? "text-green-700" : "text-red-700")
          }
        >
          {message.kind === "ok" ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5" />
          )}
          {message.text}
        </span>
      )}
    </div>
  );
}
