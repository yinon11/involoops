"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import type { DocumentType } from "@/lib/documents/types";
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  FileSignature,
  Archive,
  ShieldCheck,
  Receipt,
} from "lucide-react";

export type ItaAuthorizationGate =
  | { required: true; authorized: boolean; settingsHref: string }
  | { required: false };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (choice?: { requestAllocationAnyway?: boolean }) => void;
  isPending?: boolean;
  itaGate: ItaAuthorizationGate;
  documentType: DocumentType;
  /** Shown when the draft date is not today. Null when they match. */
  dateChangeNotice?: string | null;
  /**
   * Set when the invoice needs an allocation number and the customer has
   * no usable licensed-dealer number. Issuing is blocked until it's fixed;
   * the server refuses too, this just says so before the click.
   */
  customerTaxIdBlock?: { customerHref: string | null } | null;
  /**
   * A tax invoice about to be issued at 0% VAT with no reverse charge.
   * Legitimate for an Osek Patur or an export — but also exactly what a
   * VAT toggle left off by mistake produces, and a zero-VAT document
   * skips the allocation flow, so no later gate will ask. Not a block;
   * a last plain-words look before an irreversible document.
   */
  zeroVatNotice?: boolean;
}

export function IssueConfirmationModal({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
  itaGate,
  documentType,
  dateChangeNotice = null,
  customerTaxIdBlock = null,
  zeroVatNotice = false,
}: Props) {
  const { dict } = useI18n();
  const blockedByAuth = itaGate.required && !itaGate.authorized;
  const canAskAnyway =
    !itaGate.required &&
    (documentType === "TAX_INVOICE" || documentType === "TAX_INVOICE_RECEIPT");
  const [askAnyway, setAskAnyway] = useState(false);

  // Each opening starts unticked. Reset while rendering the open transition
  // rather than in an effect, so the dialog never paints last time's choice.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAskAnyway(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {format(dict.outbound.issueModal.title, {
              type: dict.documents.type[documentType],
            })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-gray-700">{dict.outbound.issueModal.description}</p>

          {dateChangeNotice ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
              {dateChangeNotice}
            </div>
          ) : null}

          {zeroVatNotice && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                {dict.outbound.issueModal.zeroVatTitle}
              </p>
              <p className="mt-1 text-xs">
                {dict.outbound.issueModal.zeroVatBody}
              </p>
            </div>
          )}

          <ol className="space-y-2 rounded-md border bg-gray-50 p-3">
            <Step icon={<FileSignature className="h-4 w-4" />} label={dict.outbound.issueModal.steps.sign} />
            <Step icon={<Receipt className="h-4 w-4" />} label={dict.outbound.issueModal.steps.pdf} />
            <Step icon={<Archive className="h-4 w-4" />} label={dict.outbound.issueModal.steps.archive} />
            {itaGate.required ? (
              itaGate.authorized ? (
                <Step
                  icon={<ShieldCheck className="h-4 w-4 text-green-700" />}
                  label={dict.outbound.issueModal.steps.shaamActive}
                  tone="ok"
                />
              ) : (
                <Step
                  icon={<AlertTriangle className="h-4 w-4 text-amber-700" />}
                  label={dict.outbound.issueModal.steps.shaamMissing}
                  tone="warn"
                />
              )
            ) : (
              <Step
                icon={<Info className="h-4 w-4 text-blue-700" />}
                label={dict.outbound.issueModal.steps.shaamBelowThreshold}
                tone="info"
              />
            )}
          </ol>

          {canAskAnyway && (
            <label className="flex items-start gap-2 rounded-md border bg-gray-50 p-3 text-gray-800">
              <Checkbox
                checked={askAnyway}
                onCheckedChange={(value) => setAskAnyway(value === true)}
                disabled={isPending}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">
                  {dict.shaamSubmission.action.requestAllocationAnyway}
                </span>
                <span className="mt-1 block text-xs text-gray-500">
                  {dict.shaamSubmission.requestAnywayHint}
                </span>
              </span>
            </label>
          )}

          {blockedByAuth && itaGate.required && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
              data-voice-issue-blocked=""
            >
              <p className="font-medium">{dict.outbound.issueModal.authBlockedTitle}</p>
              <p className="mt-1 text-xs">{dict.outbound.issueModal.authBlockedBody}</p>
              <Link
                href={itaGate.settingsHref}
                className="mt-2 inline-block text-xs font-medium text-indigo-700 underline"
                onClick={() => onOpenChange(false)}
              >
                {dict.outbound.issueModal.authBlockedCta} →
              </Link>
            </div>
          )}

          {customerTaxIdBlock && (
            <div
              className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900"
              data-voice-issue-blocked=""
            >
              <p className="font-medium">{dict.outbound.issueModal.customerTaxIdBlockedTitle}</p>
              <p className="mt-1 text-xs">{dict.outbound.issueModal.customerTaxIdBlockedBody}</p>
              {customerTaxIdBlock.customerHref && (
                <Link
                  href={customerTaxIdBlock.customerHref}
                  className="mt-2 inline-block text-xs font-medium text-indigo-700 underline"
                  onClick={() => onOpenChange(false)}
                >
                  {dict.outbound.issueModal.customerTaxIdBlockedCta} →
                </Link>
              )}
            </div>
          )}

          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <strong>{dict.outbound.issueModal.irreversibleTitle}: </strong>
            {dict.outbound.issueModal.irreversibleBody}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {dict.common.cancel}
          </Button>
          <Button
            onClick={() =>
              onConfirm(
                askAnyway ? { requestAllocationAnyway: true } : undefined,
              )
            }
            disabled={isPending || blockedByAuth || customerTaxIdBlock != null}
            className="gap-2"
            data-voice-action="confirm-issue"
            data-highlight="doc-confirm-issue"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {dict.outbound.issueModal.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  icon,
  label,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "ok" | "warn" | "info";
}) {
  const toneClass =
    tone === "ok"
      ? "text-green-900"
      : tone === "warn"
        ? "text-amber-900"
        : tone === "info"
          ? "text-blue-900"
          : "text-gray-800";
  return (
    <li className={`flex items-center gap-2 ${toneClass}`}>
      {icon}
      <span>{label}</span>
    </li>
  );
}

interface TriggerProps {
  onClick: () => void;
  disabled?: boolean;
  isPending?: boolean;
}

export function IssueTriggerButton({
  onClick,
  disabled,
  isPending,
}: TriggerProps) {
  const { dict } = useI18n();
  return (
    <Button onClick={onClick} disabled={disabled || isPending} className="gap-2">
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileSignature className="h-4 w-4" />
      )}
      {dict.outbound.action.issue}
    </Button>
  );
}

export function useIssueConfirmation() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
