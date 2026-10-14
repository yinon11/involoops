"use client";

/**
 * Confirmation prompt shown on the invoice detail page when the
 * extraction LLM flagged the row as a capital expenditure but the
 * user has not yet synced it to the depreciation schedule.
 *
 * Two outcomes:
 *   "Yes, add to depreciation" → syncFixedAssetToTaxEstimates
 *   "No, treat as expense"     → dismissFixedAssetFlag
 *
 * Either action revalidates this page so the banner disappears.
 */

import { useState, useTransition } from "react";
import { Sparkles, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  syncFixedAssetToTaxEstimates,
  dismissFixedAssetFlag,
} from "@/actions/fixed-asset-actions";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { useT } from "@/lib/i18n/client";

interface Props {
  invoiceId: string;
  expenseCategory: string | null;
  amount: number;
  currency: string;
}

export function FixedAssetBanner({
  invoiceId,
  expenseCategory,
  amount,
  currency,
}: Props) {
  const dict = useT();
  const t = dict.invoices.fixedAssetBanner;
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<"synced" | "dismissed" | null>(null);

  function handleSync() {
    startTransition(async () => {
      try {
        await syncFixedAssetToTaxEstimates(invoiceId);
        setOutcome("synced");
      } catch (e) {
        console.error(e);
      }
    });
  }

  function handleDismiss() {
    startTransition(async () => {
      try {
        await dismissFixedAssetFlag(invoiceId);
        setOutcome("dismissed");
      } catch (e) {
        console.error(e);
      }
    });
  }

  if (outcome === "synced") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <Check className="h-4 w-4 shrink-0" />
        <span>{t.syncedConfirmation}</span>
      </div>
    );
  }
  if (outcome === "dismissed") return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-900">{t.title}</p>
          <p className="text-xs text-amber-800">
            {expenseCategory ? `${expenseCategory} · ` : ""}
            <CurrencyDisplay amount={amount} currency={currency} />
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={handleSync}
          disabled={isPending}
          className="bg-amber-600 text-white hover:bg-amber-700"
        >
          {isPending ? (
            <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {t.confirm}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDismiss}
          disabled={isPending}
          className="border-amber-300 text-amber-900 hover:bg-amber-100"
        >
          {t.dismiss}
        </Button>
      </div>
    </div>
  );
}
