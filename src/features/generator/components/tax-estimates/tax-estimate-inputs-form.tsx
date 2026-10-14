"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Info, AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { annualDepreciation } from "./tax-calculations";
import type { SaveTaxEstimateInputsPayload } from "@/features/generator/actions/tax-actions";
import type { FixedAsset } from "@/db/schema/tax-estimate-inputs";
import type { TaxEstimatesLabels } from "./tax-estimates-client";
import { ImportFromExpensesDialog } from "./import-from-expenses-dialog";
import { useT } from "@/lib/i18n/client";

/**
 * Heuristic match for "this row was created by the invoice sync".
 * We do not persist a provenance flag on the JSONB row itself — instead
 * we compare against the snapshot of synced (description, amount) pairs
 * passed in from the parent. Any user-edited description still matches
 * by exact equality, which is acceptable for a "did this come from an
 * invoice?" hint badge.
 */
function isSyncedFromInvoice(
  asset: FixedAsset,
  syncedKeys: Set<string>,
): boolean {
  const key = `${asset.description.trim().toLowerCase()}|${asset.amount.toFixed(2)}|${asset.purchaseYear}`;
  return syncedKeys.has(key);
}

interface TaxEstimateInputsFormProps {
  year: number;
  initialValues: {
    taxCreditPoints: number;
    monthlyPayrollCost: number;
    hasInventory: boolean;
    fixedAssets: FixedAsset[];
  };
  onSave: (payload: SaveTaxEstimateInputsPayload) => Promise<unknown>;
  onInputsChange: (values: {
    taxCreditPoints: number;
    monthlyPayrollCost: number;
    hasInventory: boolean;
    fixedAssets: FixedAsset[];
  }) => void;
  currency: string;
  labels: TaxEstimatesLabels;
  /**
   * (description.trim().toLowerCase() | amount.toFixed(2) | purchaseYear)
   * keys for assets that originated from invoice sync. Used purely to
   * render a "synced from invoice" hint badge — never affects state.
   */
  syncedAssetKeys?: string[];
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  step = 0.25,
  prefix,
  tooltip,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  prefix?: string;
  tooltip?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-semibold text-slate-700">{label}</label>
        {tooltip && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default text-slate-400 hover:text-slate-600">
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px] text-xs leading-relaxed">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-slate-500">
            {prefix}
          </span>
        )}
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className={`w-full rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 ${prefix ? "pl-8 pr-3" : "px-3"}`}
        />
      </div>
    </div>
  );
}

export function TaxEstimateInputsForm({
  year,
  initialValues,
  onSave,
  onInputsChange,
  currency,
  labels,
  syncedAssetKeys,
}: TaxEstimateInputsFormProps) {
  const dict = useT();
  const syncedKeys = new Set(syncedAssetKeys ?? []);
  const [taxCreditPoints, setTaxCreditPoints] = useState(
    initialValues.taxCreditPoints,
  );
  const [monthlyPayrollCost, setMonthlyPayrollCost] = useState(
    initialValues.monthlyPayrollCost,
  );
  const [hasInventory, setHasInventory] = useState(initialValues.hasInventory);
  const [fixedAssets, setFixedAssets] = useState<FixedAsset[]>(
    initialValues.fixedAssets,
  );
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function notify(patch: Partial<{
    taxCreditPoints: number;
    monthlyPayrollCost: number;
    hasInventory: boolean;
    fixedAssets: FixedAsset[];
  }>) {
    onInputsChange({
      taxCreditPoints,
      monthlyPayrollCost,
      hasInventory,
      fixedAssets,
      ...patch,
    });
  }

  function updateCreditPoints(v: number) {
    setTaxCreditPoints(v);
    notify({ taxCreditPoints: v });
  }
  function updatePayroll(v: number) {
    setMonthlyPayrollCost(v);
    notify({ monthlyPayrollCost: v });
  }
  function updateInventory(v: boolean) {
    setHasInventory(v);
    notify({ hasInventory: v });
  }

  function addAsset() {
    const next: FixedAsset[] = [
      ...fixedAssets,
      { description: "", amount: 0, purchaseYear: year },
    ];
    setFixedAssets(next);
    notify({ fixedAssets: next });
  }
  function removeAsset(idx: number) {
    const next = fixedAssets.filter((_, i) => i !== idx);
    setFixedAssets(next);
    notify({ fixedAssets: next });
  }
  function updateAsset(idx: number, patch: Partial<FixedAsset>) {
    const next = fixedAssets.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    setFixedAssets(next);
    notify({ fixedAssets: next });
  }

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      await onSave({
        year,
        taxCreditPoints,
        monthlyPayrollCost,
        hasInventory,
        fixedAssets,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  const currencySymbol = currency === "ILS" ? "₪" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">
          {labels.adjustmentsTitle} — {year}
        </CardTitle>
        <p className="text-xs text-slate-500">{labels.adjustmentsSub}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Tax credit points */}
        <NumberInput
          label={labels.creditPoints}
          value={taxCreditPoints}
          onChange={updateCreditPoints}
          min={0}
          step={0.25}
          tooltip={labels.creditPointsTooltip.replace("{amount}", (2904).toLocaleString())}
        />

        {/* Monthly payroll cost */}
        <NumberInput
          label={labels.payroll}
          value={monthlyPayrollCost}
          onChange={updatePayroll}
          min={0}
          step={500}
          prefix={currencySymbol}
          tooltip={labels.payrollTooltip}
        />

        {/* Has inventory toggle */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-slate-700">
              {labels.inventoryFlag}
            </label>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default text-slate-400 hover:text-slate-600">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-xs leading-relaxed">
                  {labels.inventoryTooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <label className="flex cursor-pointer items-center gap-3">
            <div
              onClick={() => updateInventory(!hasInventory)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                hasInventory ? "bg-amber-500" : "bg-slate-200"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  hasInventory ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </div>
            <span className="text-xs text-slate-600">
              {hasInventory ? labels.hasInventory : labels.noInventory}
            </span>
          </label>
          {hasInventory && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-800">
                {labels.inventoryWarningForm}
              </p>
            </div>
          )}
        </div>

        {/* Fixed assets */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-700">
                {labels.fixedAssets}
              </span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default text-slate-400 hover:text-slate-600">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs leading-relaxed">
                    {labels.fixedAssetsTooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-1.5">
              <ImportFromExpensesDialog
                labels={{
                  triggerLabel: labels.importFromExpenses,
                  title: labels.importDialogTitle,
                  description: labels.importDialogDesc,
                  loading: labels.importDialogLoading,
                  empty: labels.importDialogEmpty,
                  cancel: labels.importDialogCancel,
                  confirm: labels.importDialogConfirm,
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={addAsset}
                className="h-7 gap-1.5 text-xs text-violet-700 hover:bg-violet-50 hover:text-violet-800"
              >
                <Plus className="h-3.5 w-3.5" />
                {labels.addAsset}
              </Button>
            </div>
          </div>

          {fixedAssets.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">
              {labels.noAssets}
            </p>
          ) : (
            <div className="space-y-2">
              {fixedAssets.map((asset, idx) => {
                const depr = annualDepreciation(asset.amount, asset.purchaseYear, year);
                const synced = isSyncedFromInvoice(asset, syncedKeys);
                return (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="sm:col-span-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder={labels.assetDescPh}
                            value={asset.description}
                            onChange={(e) =>
                              updateAsset(idx, { description: e.target.value })
                            }
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                          />
                          {synced && (
                            <span className="inline-flex shrink-0 items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                              {labels.syncedFromInvoice}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] text-slate-500">
                          {labels.assetCost} ({currencySymbol})
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={asset.amount}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) updateAsset(idx, { amount: v });
                          }}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] text-slate-500">
                          {labels.assetPurchaseYear}
                        </label>
                        <input
                          type="number"
                          min={2015}
                          max={year}
                          step={1}
                          value={asset.purchaseYear}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!isNaN(v)) updateAsset(idx, { purchaseYear: v });
                          }}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                        />
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <p className="text-[10px] text-slate-500">
                            {labels.annualDeduction}
                          </p>
                          <p className="text-xs font-semibold tabular-nums text-violet-700">
                            {depr > 0
                              ? `${currencySymbol}${depr.toLocaleString()}`
                              : "—"}
                          </p>
                        </div>
                        <button
                          onClick={() => removeAsset(idx)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          aria-label={dict.common.removeAsset}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Save */}
        <Button
          onClick={handleSave}
          disabled={isPending}
          className="w-full bg-violet-600 text-white hover:bg-violet-700"
          size="sm"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              {labels.saving}
            </>
          ) : saved ? (
            <>
              <Check className="mr-2 h-3.5 w-3.5" />
              {labels.saved}
            </>
          ) : (
            labels.saveAdjustments
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
