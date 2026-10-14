"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendOutstandingPaymentReminders } from "@/features/generator/actions/collections-actions";
import { format } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/**
 * Compact pill sized to sit inside a "needs your attention" row rather than
 * under a full-width card — the home page no longer has the colour-block
 * cards this button was first written for.
 */
const actionPillClassName =
  "inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60";

interface Target {
  id: string;
  customerName: string;
  customerEmail: string;
  formattedNumber: string | null;
}

export function HomeSendReminderButton({
  label,
  targets,
  skippedNoEmail,
}: {
  label: string;
  targets: Target[];
  skippedNoEmail: number;
}) {
  const { dict } = useI18n();
  const t = dict.homeCards.owesYou;
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const canSend = targets.length > 0;

  function send() {
    startTransition(async () => {
      const result = await sendOutstandingPaymentReminders();
      setOpen(false);
      if (result.failed.length === 0 && result.skippedNoEmail === 0) {
        toast.success(format(t.reminderSent, { sent: result.sent }));
        return;
      }
      toast.message(
        format(t.reminderPartial, {
          sent: result.sent,
          skipped: result.skippedNoEmail,
          failed: result.failed.length,
        }),
      );
    });
  }

  return (
    <>
      <button
        type="button"
        className={actionPillClassName}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.reminderTitle}</DialogTitle>
            <DialogDescription>{t.reminderBody}</DialogDescription>
          </DialogHeader>
          {canSend ? (
            <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
              {targets.map((row) => (
                <li key={row.id} className="flex flex-col">
                  <span className="font-medium text-slate-900">
                    {row.customerName}
                  </span>
                  <span className="text-xs text-slate-500">
                    {row.formattedNumber ?? "—"} · {row.customerEmail}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-700">{t.reminderNone}</p>
          )}
          {skippedNoEmail > 0 && canSend && (
            <p className="text-xs text-slate-500">
              {format(t.reminderSkipped, { count: skippedNoEmail })}
            </p>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Link
              href="/money-in?tab=outstanding"
              className="text-xs font-medium text-indigo-700 underline"
              onClick={() => setOpen(false)}
            >
              {t.viewOutstanding}
            </Link>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                {dict.common.cancel}
              </Button>
              <Button
                type="button"
                onClick={send}
                disabled={isPending || !canSend}
                className="gap-2"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t.reminderSend}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
