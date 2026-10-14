"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { verifyArchiveObjectById } from "@/features/generator/actions/archive-actions";
import { useI18n } from "@/lib/i18n/client";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";

export function ArchiveObjectVerifyButton({
  archiveObjectId,
}: {
  archiveObjectId: string;
}) {
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "fail"; text: string } | null
  >(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await verifyArchiveObjectById(archiveObjectId);
        if (res.ok) {
          setMessage({ kind: "ok", text: dict.archive.verified });
        } else {
          setMessage({
            kind: "fail",
            text: `${dict.archive.verificationFailed} (${res.reason})`,
          });
        }
      } catch (err) {
        setMessage({
          kind: "fail",
          text: err instanceof Error ? err.message : "failed",
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
        className="gap-1"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )}
        {dict.archive.action.verify}
      </Button>
      {message && (
        <span
          className={
            "flex items-center gap-1 text-[11px] " +
            (message.kind === "ok" ? "text-green-700" : "text-red-700")
          }
        >
          {message.kind === "ok" ? (
            <ShieldCheck className="h-3 w-3" />
          ) : (
            <ShieldAlert className="h-3 w-3" />
          )}
          {message.text}
        </span>
      )}
    </div>
  );
}
