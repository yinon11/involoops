"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Calculator,
  Receipt,
  Shield,
  TrendingUp,
  AlertTriangle,
  Info,
} from "lucide-react";
import { MonthlyTaxChart } from "./monthly-tax-chart";
import { TaxSummaryCard } from "./tax-summary-card";
import { TaxEstimateInputsForm } from "./tax-estimate-inputs-form";
import {
  computeTaxEstimateBundle,
  totalDepreciation,
  type TaxEstimateBundle,
} from "./tax-calculations";
import type { TaxEstimationRawData } from "@/features/generator/actions/tax-actions";
import type { SaveTaxEstimateInputsPayload } from "@/features/generator/actions/tax-actions";
import { getCurrencySymbol } from "@/lib/currency";

// ─── Labels type ─────────────────────────────────────────────────────────────

export interface TaxEstimatesLabels {
  taxYear: string;
  disclaimerTitle: string;
  disclaimerBody: string;
  sectionVat: string;
  sectionIncomeTax: string;
  sectionBituach: string;
  vatCollected: string;
  vatPaid: string;
  vatNet: string;
  vatCollectedSub: string;
  vatPaidSub: string;
  vatRefundSub: string;
  vatPayableSub: string;
  grossRevenue: string;
  totalExpenses: string;
  estDepreciation: string;
  estProfit: string;
  expensesSub: string;
  deprSub: string;
  bracketBreakdown: string;
  bracketProfit: string;
  bracketGrossTax: string;
  bracketCredit: string;
  bracketNet: string;
  estimatedIncomeTax: string;
  osekPaturNote: string;
  inventoryWarning: string;
  chartCollected: string;
  chartPaid: string;
  chartNetDue: string;
  chartRevenue: string;
  chartExpenses: string;
  niiContrib: string;
  niiSub: string;
  rateBreakdown: string;
  rateBreakdownLine1: string;
  rateBreakdownLine2: string;
  bituachProfitLabel: string;
  bituachNonApplicable: string;
  bituachEntityType: string;
  refund: string;
  adjustmentsTitle: string;
  adjustmentsSub: string;
  creditPoints: string;
  payroll: string;
  inventoryFlag: string;
  hasInventory: string;
  noInventory: string;
  inventoryWarningForm: string;
  fixedAssets: string;
  addAsset: string;
  importFromExpenses: string;
  importDialogTitle: string;
  importDialogDesc: string;
  importDialogLoading: string;
  importDialogEmpty: string;
  importDialogCancel: string;
  /** Confirm button. Use {count} as a placeholder for the selected count. */
  importDialogConfirm: string;
  syncedFromInvoice: string;
  noAssets: string;
  assetCost: string;
  assetPurchaseYear: string;
  annualDeduction: string;
  assetDescPh: string;
  saving: string;
  saved: string;
  saveAdjustments: string;
  footerDisclaimer: string;
  creditPointsTooltip: string;
  payrollTooltip: string;
  fixedAssetsTooltip: string;
  inventoryTooltip: string;
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            {icon}
          </span>
          <span className="text-base font-semibold text-slate-900">{title}</span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-6 pb-6 pt-5">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Year selector ────────────────────────────────────────────────────────────

function YearSelector({
  year,
  label,
  onChange,
}: {
  year: number;
  label: string;
  onChange: (y: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className="flex gap-1">
        {years.map((y) => (
          <button
            key={y}
            onClick={() => onChange(y)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              y === year
                ? "bg-violet-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main client ──────────────────────────────────────────────────────────────

interface TaxEstimatesClientProps {
  initialData: TaxEstimationRawData;
  saveInputs: (payload: SaveTaxEstimateInputsPayload) => Promise<unknown>;
  labels: TaxEstimatesLabels;
  /**
   * Snapshot of (description.lower|amount.toFixed(2)|year) keys for
   * fixed-asset rows that originated from invoice sync. Used only to
   * render the "synced from invoice" badge — no runtime effect.
   */
  syncedAssetKeys?: string[];
}

export function TaxEstimatesClient({
  initialData,
  saveInputs,
  labels,
  syncedAssetKeys,
}: TaxEstimatesClientProps) {
  const router = useRouter();
  const [inputs, setInputs] = useState(initialData.inputs);

  const { year, monthly, currency, isSelfEmployed, entityType } = initialData;
  const sym = getCurrencySymbol(currency);

  // ── Annual aggregates ─────────────────────────────────────────────────────
  const annualVatCollected = monthly.reduce((s, r) => s + r.vatCollected, 0);
  const annualVatPaid = monthly.reduce((s, r) => s + r.vatPaid, 0);
  const annualVatDue = annualVatCollected - annualVatPaid;
  const annualGrossRevenue = monthly.reduce((s, r) => s + r.grossRevenue, 0);
  const annualTotalExpenses = monthly.reduce((s, r) => s + r.totalExpenses, 0);

  // ── Tax estimate bundle — re-computed whenever inputs change ───────────────
  const bundle: TaxEstimateBundle = computeTaxEstimateBundle({
    annualGrossRevenue,
    annualTotalExpenses,
    monthlyPayrollCost: inputs.monthlyPayrollCost,
    fixedAssets: inputs.fixedAssets,
    taxYear: year,
    creditPoints: inputs.taxCreditPoints,
    isSelfEmployed,
  });

  const annualDeprTotal = totalDepreciation(inputs.fixedAssets, year);

  // ── VAT section data ──────────────────────────────────────────────────────
  const vatDueByMonth = monthly.map((r) => ({ month: r.month, value: r.vatDue }));
  const vatCollectedByMonth = monthly.map((r) => ({ month: r.month, value: r.vatCollected }));
  const vatPaidByMonth = monthly.map((r) => ({ month: r.month, value: r.vatPaid }));

  // ── Revenue/expense chart data ────────────────────────────────────────────
  const revenueByMonth = monthly.map((r) => ({ month: r.month, value: r.grossRevenue }));
  const expensesByMonth = monthly.map((r) => ({ month: r.month, value: r.totalExpenses }));

  // ── Year change → navigate ────────────────────────────────────────────────
  function handleYearChange(y: number) {
    router.push(`/outbound/tax-estimates?year=${y}`);
  }

  const handleInputsChange = useCallback(
    (vals: typeof inputs) => setInputs(vals),
    [],
  );

  // ── VAT tone ──────────────────────────────────────────────────────────────
  function vatTone(due: number) {
    if (due < 0) return "green" as const;
    if (due < 5_000) return "amber" as const;
    return "red" as const;
  }
  // ── Income tax tone ───────────────────────────────────────────────────────
  function incomeTaxTone(tax: number) {
    if (tax < 10_000) return "green" as const;
    if (tax < 50_000) return "amber" as const;
    return "red" as const;
  }

  const isOsekPatur = entityType === "OSEK_PATUR";

  return (
    <div className="space-y-5">
      {/* Year selector */}
      <YearSelector year={year} label={labels.taxYear} onChange={handleYearChange} />

      {/* Disclaimer */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-amber-900">
            {labels.disclaimerTitle}
          </p>
          <p className="text-xs text-amber-800">{labels.disclaimerBody}</p>
        </div>
      </div>

      {/* Main layout: sections left, inputs right */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sections column */}
        <div className="space-y-4 lg:col-span-2">
          {/* ── VAT section ── */}
          <Section title={labels.sectionVat} icon={<Receipt className="h-4 w-4" />}>
            {isOsekPatur && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                <p className="text-xs text-blue-800">{labels.osekPaturNote}</p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <TaxSummaryCard
                label={labels.vatCollected}
                value={annualVatCollected}
                currency={currency}
                tone="slate"
                icon={<TrendingUp className="h-5 w-5" />}
                subtitle={labels.vatCollectedSub}
                refundLabel={labels.refund}
              />
              <TaxSummaryCard
                label={labels.vatPaid}
                value={annualVatPaid}
                currency={currency}
                tone="slate"
                icon={<Receipt className="h-5 w-5" />}
                subtitle={labels.vatPaidSub}
                refundLabel={labels.refund}
              />
              <TaxSummaryCard
                label={labels.vatNet}
                value={annualVatDue}
                currency={currency}
                tone={vatTone(annualVatDue)}
                icon={<Calculator className="h-5 w-5" />}
                subtitle={annualVatDue < 0 ? labels.vatRefundSub : labels.vatPayableSub}
                refundLabel={labels.refund}
              />
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <MonthlyTaxChart
                data={vatCollectedByMonth}
                title={labels.chartCollected}
                currency={currency}
                positiveColor="#0D9488"
              />
              <MonthlyTaxChart
                data={vatPaidByMonth}
                title={labels.chartPaid}
                currency={currency}
                positiveColor="#6366f1"
              />
              <MonthlyTaxChart
                data={vatDueByMonth}
                title={labels.chartNetDue}
                currency={currency}
                signColored
                positiveColor="#F59E0B"
                negativeColor="#10b981"
              />
            </div>
          </Section>

          {/* ── Income Tax section ── */}
          <Section
            title={labels.sectionIncomeTax}
            icon={<Calculator className="h-4 w-4" />}
            defaultOpen={false}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <TaxSummaryCard
                label={labels.grossRevenue}
                value={annualGrossRevenue}
                currency={currency}
                tone="slate"
                icon={<TrendingUp className="h-5 w-5" />}
                refundLabel={labels.refund}
              />
              <TaxSummaryCard
                label={labels.totalExpenses}
                value={annualTotalExpenses}
                currency={currency}
                tone="slate"
                icon={<Receipt className="h-5 w-5" />}
                subtitle={labels.expensesSub}
                refundLabel={labels.refund}
              />
              <TaxSummaryCard
                label={labels.estDepreciation}
                value={annualDeprTotal}
                currency={currency}
                tone="slate"
                subtitle={labels.deprSub}
                refundLabel={labels.refund}
              />
              <TaxSummaryCard
                label={labels.estProfit}
                value={bundle.estimatedProfit}
                currency={currency}
                tone={bundle.estimatedProfit < 0 ? "green" : "amber"}
                subtitle={`${sym}${(bundle.annualPayrollCost).toLocaleString()}`}
                refundLabel={labels.refund}
              />
            </div>

            {inputs.hasInventory && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">{labels.inventoryWarning}</p>
              </div>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TaxSummaryCard
                label={labels.estimatedIncomeTax}
                value={bundle.netIncomeTax}
                currency={currency}
                tone={incomeTaxTone(bundle.netIncomeTax)}
                icon={<Calculator className="h-5 w-5" />}
                subtitle={`${inputs.taxCreditPoints} × 2,904 ILS`}
                refundLabel={labels.refund}
              />
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-600 space-y-1.5">
                <p className="font-semibold text-slate-700">{labels.bracketBreakdown}</p>
                <p>{labels.bracketProfit} {sym}{bundle.estimatedProfit.toLocaleString()}</p>
                <p>{labels.bracketGrossTax} {sym}{bundle.grossIncomeTax.toLocaleString()}</p>
                <p>{labels.bracketCredit} {sym}{Math.round(inputs.taxCreditPoints * 2904).toLocaleString()} ({inputs.taxCreditPoints} pts)</p>
                <p className="font-semibold text-slate-800 pt-1 border-t border-slate-200">
                  {labels.bracketNet} {sym}{bundle.netIncomeTax.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <MonthlyTaxChart
                data={revenueByMonth}
                title={labels.chartRevenue}
                currency={currency}
                positiveColor="#0D9488"
              />
              <MonthlyTaxChart
                data={expensesByMonth}
                title={labels.chartExpenses}
                currency={currency}
                positiveColor="#6366f1"
              />
            </div>
          </Section>

          {/* ── Bituach Leumi section ── */}
          {isSelfEmployed ? (
            <Section
              title={labels.sectionBituach}
              icon={<Shield className="h-4 w-4" />}
              defaultOpen={false}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TaxSummaryCard
                  label={labels.niiContrib}
                  value={bundle.bituachLeumi ?? 0}
                  currency={currency}
                  tone={
                    (bundle.bituachLeumi ?? 0) < 5_000
                      ? "green"
                      : (bundle.bituachLeumi ?? 0) < 20_000
                        ? "amber"
                        : "red"
                  }
                  icon={<Shield className="h-5 w-5" />}
                  subtitle={labels.niiSub}
                  refundLabel={labels.refund}
                />
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-600 space-y-1.5">
                  <p className="font-semibold text-slate-700">{labels.rateBreakdown}</p>
                  <p>{labels.rateBreakdownLine1}</p>
                  <p>{labels.rateBreakdownLine2}</p>
                  <p className="pt-1 border-t border-slate-200 text-slate-500">
                    {labels.bituachProfitLabel} {sym}{(bundle.estimatedProfit).toLocaleString()}
                  </p>
                </div>
              </div>
            </Section>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-center text-xs text-slate-500">
              <Shield className="mx-auto mb-2 h-6 w-6 opacity-30" />
              {labels.bituachNonApplicable}
              {entityType && (
                <span>{" "}{labels.bituachEntityType.replace("{entityType}", entityType)}</span>
              )}
            </div>
          )}
        </div>

        {/* Inputs panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            <TaxEstimateInputsForm
              year={year}
              initialValues={initialData.inputs}
              onSave={saveInputs}
              onInputsChange={handleInputsChange}
              currency={currency}
              labels={labels}
              syncedAssetKeys={syncedAssetKeys}
            />
          </div>
        </div>
      </div>

      {/* Bottom disclaimer repeat */}
      <p className="text-center text-[11px] text-slate-400">
        {labels.footerDisclaimer}
      </p>
    </div>
  );
}
