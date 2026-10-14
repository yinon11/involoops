"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import {
  sendOutboundInvoiceByEmail,
  type SendOutboundInvoiceResult,
} from "@/features/generator/actions/outbound-invoice-actions";
import { setCustomerAutoSendPreference } from "@/features/generator/actions/customer-actions";
import { Loader2, Send, X } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  formattedNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  defaultSubject: string;
  defaultBody: string;
  /** Saved business default. The prompt does not ask again. */
  attachWithholdingCertificate?: boolean;
  /** Fired after a successful send so the parent can refresh state. */
  onSent: (result: SendOutboundInvoiceResult) => void;
}

export function PostIssueSendPrompt({
  open,
  onOpenChange,
  invoiceId,
  formattedNumber,
  customerId,
  customerName,
  customerEmail,
  defaultSubject,
  defaultBody,
  attachWithholdingCertificate = false,
  onSent,
}: Props) {
  const { dict } = useI18n();
  const [remember, setRemember] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasEmail = customerEmail.trim().length > 0;

  async function decide(decision: "send" | "skip") {
    if (remember) {
      try {
        await setCustomerAutoSendPreference(
          customerId,
          decision === "send",
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : String(err),
        );
        return;
      }
    }

    if (decision === "skip") {
      onOpenChange(false);
      return;
    }

    const result = await sendOutboundInvoiceByEmail({
      invoiceId,
      to: customerEmail,
      subject: defaultSubject,
      body: defaultBody,
      attachWithholdingCertificate,
    });
    if (result.success) {
      toast.success(
        dict.outbound.sendModal.sentSuccess.replace(
          "{email}",
          customerEmail,
        ),
      );
      onSent(result);
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{dict.outbound.postIssuePrompt.title}</DialogTitle>
          <DialogDescription>
            {hasEmail
              ? dict.outbound.postIssuePrompt.body
                  .replace("{customer}", customerName)
                  .replace("{email}", customerEmail)
                  .replace("{number}", formattedNumber)
              : dict.outbound.postIssuePrompt.noEmail.replace(
                  "{customer}",
                  customerName,
                )}
          </DialogDescription>
        </DialogHeader>

        {hasEmail && (
          <label className="flex items-start gap-2 rounded-md border bg-gray-50 px-3 py-2 text-sm">
            <Checkbox
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
              disabled={isPending}
              className="mt-0.5"
            />
            <span className="text-gray-700">
              {dict.outbound.postIssuePrompt.remember.replace(
                "{customer}",
                customerName,
              )}
            </span>
          </label>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              startTransition(async () => {
                await decide("skip");
              })
            }
            disabled={isPending}
            className="gap-2"
          >
            <X className="h-4 w-4" />
            {dict.outbound.postIssuePrompt.skipButton}
          </Button>
          {hasEmail && (
            <Button
              onClick={() =>
                startTransition(async () => {
                  await decide("send");
                })
              }
              disabled={isPending}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {dict.outbound.postIssuePrompt.sendButton}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
