"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import {
  PAYMENT_METHODS,
  type PaymentEntry,
  type PaymentMethod,
} from "@/lib/documents/payments";
import { assessCashCeiling } from "@/lib/documents/cash-ceiling";
import { Plus, Trash2, AlertCircle, AlertTriangle } from "lucide-react";

interface Props {
  value: PaymentEntry[];
  onChange: (next: PaymentEntry[]) => void;
  currency: string;
  /** Invoice total — shown as "required sum" plus live delta. */
  total: number;
  /** Default date (usually the invoice date). */
  defaultDate: string;
  /** False when the business has not uploaded a withholding certificate. */
  hasWithholdingCertificate?: boolean;
  /** Customer's licensed-dealer number, when they have one. */
  customerTaxId?: string | null;
  /** ILS per 1 unit of `currency`. Unused for ILS. */
  fxRateToIls?: number | null;
}

export function PaymentsInput({
  value,
  onChange,
  currency,
  total,
  defaultDate,
  hasWithholdingCertificate = false,
  customerTaxId = null,
  fxRateToIls = null,
}: Props) {
  const { dict } = useI18n();
  const L = dict.outbound.payments;
  const cashCeiling = assessCashCeiling({
    payments: value,
    transactionTotal: total,
    currency,
    fxRateToIls,
    customerTaxId,
  });
  const sum = value.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const delta = Math.round((total - sum) * 100) / 100;
  const ok = Math.abs(delta) < 0.005;
  const showWithholdingPrompt =
    !hasWithholdingCertificate &&
    value.some((p) => p.method === "withholding_tax");

  function add() {
    onChange([
      ...value,
      {
        method: "bank_transfer",
        amount: delta > 0 ? delta : 0,
        currency,
        date: defaultDate,
      },
    ]);
  }

  function addWithholding() {
    onChange([
      ...value,
      {
        method: "withholding_tax",
        amount: 0,
        currency,
        date: defaultDate,
      },
    ]);
  }

  function remove(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  function update<K extends keyof PaymentEntry>(
    i: number,
    field: K,
    next: PaymentEntry[K],
  ) {
    onChange(
      value.map((p, j) => (j === i ? { ...p, [field]: next } : p)),
    );
  }

  return (
    <div className="space-y-3">
      {value.map((p, i) => {
        const needsReference =
          p.method !== "cash" && p.method !== "withholding_tax";
        return (
          <div key={i} className="grid grid-cols-12 items-start gap-2">
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">{L.method}</Label>
              <Select
                value={p.method}
                onValueChange={(v) =>
                  update(i, "method", v as PaymentMethod)
                }
              >
                <SelectTrigger
                  data-voice-field={i === 0 ? "paymentMethod" : `paymentMethod-${i}`}
                  data-voice-select="true"
                  data-highlight={i === 0 ? "doc-payment-method" : undefined}
                >
                  <SelectValue>{L.methodLabel[p.method]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m} data-value={m}>
                      {L.methodLabel[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">{L.amount}</Label>
              <Input
                type="number"
                step="0.01"
                value={p.amount || ""}
                onChange={(e) =>
                  update(i, "amount", Number(e.target.value) || 0)
                }
                className="font-mono tabular-nums"
                data-voice-field={i === 0 ? "paymentAmount" : `paymentAmount-${i}`}
                data-highlight={i === 0 ? "doc-payment-amount" : undefined}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">{L.date}</Label>
              <Input
                type="date"
                value={p.date}
                onChange={(e) => update(i, "date", e.target.value)}
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">
                {L.reference}
                {needsReference && (
                  <span className="text-red-600">*</span>
                )}
              </Label>
              <Input
                value={p.reference ?? ""}
                onChange={(e) => update(i, "reference", e.target.value)}
                placeholder={
                  p.method === "check"
                    ? L.placeholders.check
                    : p.method === "card"
                      ? L.placeholders.card
                      : p.method === "bank_transfer"
                        ? L.placeholders.bankTransfer
                        : ""
                }
                data-voice-field={i === 0 ? "paymentReference" : `paymentReference-${i}`}
                data-highlight={i === 0 ? "doc-payment-reference" : undefined}
              />
            </div>
            <div className="col-span-1 flex items-end justify-end">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(i)}
                aria-label={L.remove}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </div>
        );
      })}

      {cashCeiling?.exceeded && (
        <div className="rounded-md border-2 border-amber-600 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-1">
              <p className="text-sm font-bold">{L.cashCeilingWarning}</p>
              <p className="text-xs">
                {format(L.cashCeilingDetail, {
                  kind: L.cashCeilingKind[cashCeiling.counterparty],
                  permitted: cashCeiling.permittedIls.toLocaleString(),
                  cash: cashCeiling.cashIls.toLocaleString(),
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {showWithholdingPrompt && (
        <p className="text-xs text-amber-900">
          {L.withholdingMissing}{" "}
          <Link href="/creator/business-details" className="font-medium underline">
            {L.withholdingMissingLink}
          </Link>{" "}
          {L.withholdingMissingTail}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            className="gap-1"
            data-voice-action="add-payment"
            data-highlight="doc-add-payment"
          >
            <Plus className="h-4 w-4" /> {L.add}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addWithholding}
            className="gap-1"
            data-voice-action="add-withholding"
            data-highlight="doc-add-withholding"
          >
            <Plus className="h-4 w-4" /> {L.addWithholding}
          </Button>
        </div>
        <div
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
            ok
              ? "bg-emerald-50 text-emerald-800"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          {!ok && <AlertCircle className="h-3.5 w-3.5" />}
          <span>
            {L.sum}: <span className="font-mono">{sum.toFixed(2)}</span>{" "}
            {currency}
            {" · "}
            {L.required}:{" "}
            <span className="font-mono">{total.toFixed(2)}</span> {currency}
            {!ok && (
              <>
                {" · "}
                {L.delta}:{" "}
                <span className="font-mono">
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(2)}
                </span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
