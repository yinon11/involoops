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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/client";
import {
  queueOutboundInvoiceForDelivery,
  sendOutboundInvoiceByEmail,
} from "@/features/generator/actions/outbound-invoice-actions";
import { AlertTriangle, Clock, Loader2, Paperclip, Send } from "lucide-react";
import Link from "next/link";

type ShaamGate =
  | "PENDING"
  | "OUTAGE_ISSUED"
  | "REJECTED"
  | "HELD"
  | "UNRESOLVED";

/**
 * Accept the full `ShaamStatus` union (including NOT_APPLICABLE / NOT_REQUIRED
 * / APPROVED / null / undefined) and narrow internally — the parent passes
 * its `shaamStatus` straight through and we only act on the gate-blocking
 * subset.
 */
type ShaamStatusInput =
  | "NOT_APPLICABLE"
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "HELD"
  | "OUTAGE_ISSUED"
  | "ISSUED_WITHOUT_ALLOCATION"
  | "CANCELLED_AFTER_REJECTION"
  | "UNRESOLVED"
  | null
  | undefined;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  formattedNumber: string;
  defaultTo: string;
  defaultSubject: string;
  defaultBody: string;
  /** Current SHAAM state. Drives the warning banner + the "Send anyway" /
   *  "Queue for clear" controls. Anything other than PENDING / OUTAGE_ISSUED /
   *  REJECTED / HELD is treated as "not gated". */
  shaamStatus?: ShaamStatusInput;
  /** Saved certificate. Null when the business has not uploaded one. */
  withholdingCertificate?: {
    filename: string | null;
    attachByDefault: boolean;
    expired: boolean;
  } | null;
  onSent: () => void;
}

const GATE_STATES: ReadonlySet<ShaamGate> = new Set([
  "PENDING",
  "OUTAGE_ISSUED",
  "REJECTED",
  "HELD",
]);

function asGate(s: ShaamStatusInput): ShaamGate | null {
  if (s && (GATE_STATES as ReadonlySet<string>).has(s)) {
    return s as ShaamGate;
  }
  return null;
}

export function SendInvoiceModal({
  open,
  onOpenChange,
  invoiceId,
  formattedNumber,
  defaultTo,
  defaultSubject,
  defaultBody,
  shaamStatus,
  withholdingCertificate = null,
  onSent,
}: Props) {
  const { dict } = useI18n();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [forceSend, setForceSend] = useState(false);
  const [attachCertificate, setAttachCertificate] = useState(false);
  const [isPending, startTransition] = useTransition();

  const gateState = asGate(shaamStatus);
  const gated = gateState !== null;
  // Queueing only makes sense while SHAAM might still clear. REJECTED /
  // HELD are terminal; the seller's only options are fix-and-reissue or
  // force-send.
  const canQueue =
    gateState === "PENDING" || gateState === "OUTAGE_ISSUED";

  // Reset the form when the modal opens, adjusting state during render on a
  // changed input rather than in an effect.
  //
  // Deliberate behaviour change, though a narrower one than it first looks.
  // The old effect also listed defaultTo / defaultSubject / defaultBody in
  // its deps. Those are strings, and deps compare by value, so it re-fired
  // only when a value actually changed — which needs a router.refresh() or
  // a locale change to land while the modal is open AND bring different
  // customer data or invoice number. Every router.refresh() in
  // invoice-view-client today runs before this modal opens or as it closes,
  // so this was a latent hazard rather than a reproducible bug.
  //
  // Keying the reset on the open transition closes it anyway: replacing text
  // someone is mid-way through typing is not a behaviour worth keeping
  // available. Fresh defaults on every open are unchanged.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTo(defaultTo);
      setSubject(defaultSubject);
      setBody(defaultBody);
      setForceSend(false);
      setAttachCertificate(Boolean(withholdingCertificate?.attachByDefault));
    }
  }

  function handleSend() {
    startTransition(async () => {
      const result = await sendOutboundInvoiceByEmail({
        invoiceId,
        to,
        subject,
        body,
        force: gated ? forceSend : false,
        attachWithholdingCertificate: Boolean(
          withholdingCertificate && attachCertificate,
        ),
      });
      if (result.success) {
        toast.success(
          dict.outbound.sendModal.sentSuccess.replace("{email}", to),
        );
        onOpenChange(false);
        onSent();
        return;
      }
      // Gated rejection — refresh the warning state and tell the user.
      if ("shaamGate" in result) {
        toast.error(result.error);
        return;
      }
      toast.error(result.error);
    });
  }

  function handleQueue() {
    startTransition(async () => {
      const result = await queueOutboundInvoiceForDelivery({
        invoiceId,
        to,
        subject,
        body,
        attachWithholdingCertificate: Boolean(
          withholdingCertificate && attachCertificate,
        ),
      });
      if (result.success) {
        toast.success(dict.outbound.sendModal.queuedSuccess);
        onOpenChange(false);
        onSent();
      } else {
        toast.error(result.error);
      }
    });
  }

  const recipientOk = to.trim().length > 0 && subject.trim().length > 0;
  const canSend = recipientOk && (!gated || forceSend);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{dict.outbound.sendModal.title}</DialogTitle>
          <DialogDescription>
            {dict.outbound.sendModal.description.replace(
              "{number}",
              formattedNumber,
            )}
          </DialogDescription>
        </DialogHeader>

        {gateState && (
          <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">
                {dict.outbound.sendModal.shaamGate[gateState].title}
              </p>
              <p className="text-amber-800">
                {dict.outbound.sendModal.shaamGate[gateState].body}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="send-invoice-to">
              {dict.outbound.sendModal.to}
            </Label>
            <Input
              id="send-invoice-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@example.com"
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="send-invoice-subject">
              {dict.outbound.sendModal.subject}
            </Label>
            <Input
              id="send-invoice-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="send-invoice-body">
              {dict.outbound.sendModal.message}
            </Label>
            <Textarea
              id="send-invoice-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              disabled={isPending}
            />
          </div>

          <div className="flex items-center gap-2 rounded-md border bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <Paperclip className="h-3.5 w-3.5" />
            <span>
              {dict.outbound.sendModal.attachmentLabel.replace(
                "{filename}",
                `invoice-${formattedNumber}.pdf`,
              )}
            </span>
          </div>

          {withholdingCertificate ? (
            <div className="space-y-1">
              <label className="flex items-start gap-2 rounded-md border bg-gray-50 px-3 py-2 text-sm">
                <Checkbox
                  checked={attachCertificate}
                  onCheckedChange={(v) => setAttachCertificate(v === true)}
                  disabled={isPending}
                  className="mt-0.5"
                />
                <span className="text-gray-700">
                  {dict.outbound.sendModal.attachWithholding}
                  {withholdingCertificate.filename
                    ? ` (${withholdingCertificate.filename})`
                    : ""}
                </span>
              </label>
              {withholdingCertificate.expired && (
                <p className="text-xs text-amber-800">
                  {dict.outbound.sendModal.certificateExpired}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              {dict.outbound.sendModal.attachWithholdingMissing}{" "}
              <Link
                href="/creator/business-details"
                className="font-medium underline"
              >
                {dict.outbound.sendModal.attachWithholdingMissingLink}
              </Link>
            </p>
          )}

          {gated && (
            <label className="flex items-start gap-2 rounded-md border bg-gray-50 px-3 py-2 text-sm">
              <Checkbox
                checked={forceSend}
                onCheckedChange={(v) => setForceSend(v === true)}
                disabled={isPending}
                className="mt-0.5"
              />
              <span className="text-gray-700">
                {dict.outbound.sendModal.forceCheckbox}
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {dict.common.cancel}
          </Button>
          {gated && canQueue && (
            <Button
              variant="outline"
              onClick={handleQueue}
              disabled={isPending || !recipientOk}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
              {dict.outbound.sendModal.queueButton}
            </Button>
          )}
          <Button
            onClick={handleSend}
            disabled={isPending || !canSend}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {gated
              ? dict.outbound.sendModal.sendAnywayButton
              : dict.outbound.sendModal.sendButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
