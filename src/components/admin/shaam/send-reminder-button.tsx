"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sendStuckReminderForEntity } from "@/actions/shaam-actions";
import { Loader2, Mail } from "lucide-react";

export function SendReminderButton({
  businessEntityId,
  label,
}: {
  businessEntityId: string;
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const res = await sendStuckReminderForEntity(businessEntityId);
      setMessage(res.ok ? "Sent (if applicable)" : res.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={run}
        disabled={isPending}
        className="gap-1"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Mail className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {message && (
        <span className="text-[11px] text-gray-600">{message}</span>
      )}
    </div>
  );
}
