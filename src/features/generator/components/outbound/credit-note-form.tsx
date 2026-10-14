"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { issueCreditNote } from "@/features/generator/actions/credit-note-actions";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import {
  CreditReasonSelector,
  type CreditReasonKey,
} from "@/features/generator/components/outbound/credit-reason-selector";
import { FileMinus, Loader2, AlertTriangle } from "lucide-react";

interface ExistingCredit {
  amount: string;
  formattedNumber: string;
}

interface Props {
  originalInvoiceId: string;
  originalFormattedNumber: string;
  originalCustomerName: string | null;
  originalGrandTotal: string;
  remainingAmount: string;
  /** VAT rate of the original invoice (e.g. "18", "0", "17"). */
  vatRate: string;
  currency: string;
  /** Spec 11 §5 — displayed prominently; ITA needs it on credit notes. */
  originalAllocationNumber?: string | null;
  /** Spec 11 §5 — used for the duplicate-amount warning. */
  existingCredits?: ExistingCredit[];
}

type AmountMode = "gross" | "net";

/**
 * Round a number to 2 decimals via integer-cent arithmetic.
 */
function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Split a user-entered amount into net / vat / gross at a given VAT rate.
 * `mode === "gross"` means the input already includes VAT; `"net"` means
 * VAT must be added on top. VAT rate of 0 is supported (no division).
 */
function splitAmount(
  raw: string,
  mode: AmountMode,
  vatRatePercent: number,
): { net: number; vat: number; gross: number } {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { net: 0, vat: 0, gross: 0 };
  }
  if (vatRatePercent <= 0) {
    return { net: round2(value), vat: 0, gross: round2(value) };
  }
  if (mode === "gross") {
    const net = round2(value / (1 + vatRatePercent / 100));
    const gross = round2(value);
    return { net, vat: round2(gross - net), gross };
  }
  // mode === "net"
  const net = round2(value);
  const vat = round2(net * (vatRatePercent / 100));
  return { net, vat, gross: round2(net + vat) };
}

export function CreditNoteForm({
  originalInvoiceId,
  originalFormattedNumber,
  originalCustomerName,
  originalGrandTotal,
  remainingAmount,
  vatRate,
  currency,
  originalAllocationNumber,
  existingCredits = [],
}: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const [isPending, startTransition] = useTransition();
  const vatRateNum = Number(vatRate) || 0;
  const [amountMode, setAmountMode] = useState<AmountMode>("gross");
  // The visible input always reflects the chosen mode. Default to the
  // remaining (gross) so a one-click full credit still works.
  const [amountInput, setAmountInput] = useState(remainingAmount);
  const [reasonKey, setReasonKey] = useState<CreditReasonKey | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const split = useMemo(
    () => splitAmount(amountInput, amountMode, vatRateNum),
    [amountInput, amountMode, vatRateNum],
  );

  const grossStr = split.gross.toFixed(2);

  const duplicate = existingCredits.find(
    (c) => Number(c.amount).toFixed(2) === grossStr,
  );

  const remainingAfter = Math.max(
    0,
    Number(remainingAmount) - split.gross,
  ).toFixed(2);

  const exceedsRemaining = split.gross - Number(remainingAmount) > 0.005;

  function onModeChange(next: AmountMode) {
    if (next === amountMode) return;
    // Convert the current entry to the new mode so the user doesn't lose
    // their work when toggling include/exclude VAT.
    if (next === "gross") {
      setAmountInput(split.gross > 0 ? split.gross.toFixed(2) : amountInput);
    } else {
      setAmountInput(split.net > 0 ? split.net.toFixed(2) : amountInput);
    }
    setAmountMode(next);
  }

  function submit() {
    setError(null);
    if (split.gross <= 0) {
      setError(dict.outbound.creditNote.errors.amountNotPositive);
      return;
    }
    if (exceedsRemaining) {
      setError(dict.outbound.creditNote.errors.amountExceedsRemaining);
      return;
    }
    setConfirmOpen(true);
  }

  function confirmAndIssue() {
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await issueCreditNote({
        originalInvoiceId,
        // The op + validation interpret `creditAmount` as the gross
        // (VAT-inclusive) amount; net/VAT are derived from it.
        creditAmount: grossStr,
        reason,
      });
      if (result.success) {
        router.push(`/outbound/${result.creditNoteId}`);
      } else {
        setError(
          result.documentsLocked
            ? dict.outbound.issuanceLockedBody
            : result.error,
        );
      }
    });
  }

  const vatLabel = format(dict.outbound.creditNote.vatLine, {
    rate: vatRateNum.toString(),
  });

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">
          {dict.outbound.creditNote.action}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-md bg-gray-50 p-4 text-sm">
          <dt className="text-gray-500">{dict.outbound.creditNote.original}</dt>
          <dd className="font-mono">{originalFormattedNumber}</dd>
          <dt className="text-gray-500">{dict.verify.field.customer}</dt>
          <dd>{originalCustomerName ?? "—"}</dd>
          <dt className="text-gray-500">{dict.verify.field.total}</dt>
          <dd>
            {originalGrandTotal} {currency}
          </dd>
          <dt className="text-gray-500">
            {format(dict.outbound.creditNote.amountRemaining, {
              amount: "",
            }).trim()}
          </dt>
          <dd className="font-semibold">
            {remainingAmount} {currency}
          </dd>
          {originalAllocationNumber && (
            <>
              <dt className="text-gray-500">
                {dict.outbound.creditNote.originalAllocation}
              </dt>
              <dd className="font-mono">
                {originalAllocationNumber.length > 9 ? (
                  <>
                    <span className="text-gray-500">
                      {originalAllocationNumber.slice(0, originalAllocationNumber.length - 9)}
                    </span>
                    <span className="font-semibold text-green-800">
                      {originalAllocationNumber.slice(-9)}
                    </span>
                  </>
                ) : (
                  originalAllocationNumber
                )}
              </dd>
            </>
          )}
        </dl>

        <div className="space-y-2">
          <Label>{dict.outbound.creditNote.amount}</Label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
            />
            <Select
              value={amountMode}
              onValueChange={(v) => onModeChange(v as AmountMode)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gross">
                  {dict.outbound.creditNote.amountMode.gross}
                </SelectItem>
                <SelectItem value="net">
                  {dict.outbound.creditNote.amountMode.net}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-gray-500">
            {format(dict.outbound.creditNote.amountRemaining, {
              amount: `${remainingAmount} ${currency}`,
            })}
          </p>

          <dl className="mt-2 grid grid-cols-2 gap-1 rounded-md border bg-white px-3 py-2 text-sm">
            <dt className="text-gray-500">
              {dict.outbound.creditNote.subtotalLine}
            </dt>
            <dd className="text-end font-mono tabular-nums">
              {split.net.toFixed(2)} {currency}
            </dd>
            <dt className="text-gray-500">{vatLabel}</dt>
            <dd className="text-end font-mono tabular-nums">
              {split.vat.toFixed(2)} {currency}
            </dd>
            <dt className="font-semibold">
              {dict.outbound.creditNote.totalLine}
            </dt>
            <dd className="text-end font-mono font-semibold tabular-nums">
              {split.gross.toFixed(2)} {currency}
            </dd>
          </dl>

          {split.gross > 0 && !exceedsRemaining && (
            <p className="text-[11px] text-gray-500">
              {format(dict.outbound.creditNote.remainingAfter, {
                amount: remainingAfter,
                currency,
              })}
            </p>
          )}
          {exceedsRemaining && (
            <p className="text-[11px] text-red-600">
              {dict.outbound.creditNote.errors.amountExceedsRemaining}
            </p>
          )}
          {duplicate && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{dict.outbound.creditNote.duplicateWarning}</span>
            </div>
          )}
        </div>

        <CreditReasonSelector
          reasonKey={reasonKey}
          reasonText={reason}
          invalid={error === "reason_too_short"}
          onChange={(key, text) => {
            setReasonKey(key);
            setReason(text);
            if (error === "reason_too_short" && text.trim().length >= 10) {
              setError(null);
            }
          }}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending} className="gap-2">
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileMinus className="h-4 w-4" />
            )}
            {dict.outbound.creditNote.action}
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.outbound.creditNote.confirm.title}</DialogTitle>
            <DialogDescription>
              {dict.outbound.creditNote.confirm.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmAndIssue}
              disabled={isPending}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileMinus className="h-4 w-4" />
              )}
              {dict.outbound.creditNote.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
