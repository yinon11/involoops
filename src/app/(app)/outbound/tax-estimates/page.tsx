import { Suspense } from "react";
import { Calculator } from "lucide-react";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDictionary } from "@/lib/i18n/server";
import {
  getTaxEstimationData,
  getWithholdingReconciliation,
  saveTaxEstimateInputs,
} from "@/features/generator/actions/tax-actions";
import { getSyncedFixedAssetKeys } from "@/actions/fixed-asset-actions";
import { TaxEstimatesClient } from "@/features/generator/components/tax-estimates/tax-estimates-client";
import { WithholdingReconciliationCard } from "@/features/generator/components/tax-estimates/withholding-reconciliation-card";

export const metadata = {
  title: "Tax Estimates — InvoLoops Studio",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ year?: string }>;
}

export default async function TaxEstimatesPage({ searchParams }: PageProps) {
  await requireGeneratorAccess();

  const { year: yearParam } = await searchParams;
  const requestedYear = yearParam ? parseInt(yearParam, 10) : undefined;
  const year =
    requestedYear && !isNaN(requestedYear) && requestedYear > 2000
      ? requestedYear
      : undefined;

  const [data, dict, syncedAssetKeys, withholding] = await Promise.all([
    getTaxEstimationData(year),
    getDictionary(),
    getSyncedFixedAssetKeys().catch(() => [] as string[]),
    getWithholdingReconciliation(year),
  ]);

  const L = dict.shell.creator.taxEstimates;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
          <Calculator className="h-5 w-5" />
        </span>
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-900"
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              letterSpacing: "-0.02em",
            }}
          >
            {L.pageTitle}
          </h1>
          <p className="text-sm text-slate-500">{L.pageSubtitle}</p>
        </div>
      </div>

      <Suspense fallback={
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
      }>
        <TaxEstimatesClient
          initialData={data}
          saveInputs={saveTaxEstimateInputs}
          labels={L}
          syncedAssetKeys={syncedAssetKeys}
        />
      </Suspense>

      {/* Only surfaced for sellers whose customers actually withhold. */}
      {withholding.hasWithholding ? (
        <WithholdingReconciliationCard
          data={withholding}
          labels={{
            title: L.withholdingTitle,
            subtitle: L.withholdingSubtitle,
            colCustomer: L.withholdingColCustomer,
            colReceipts: L.withholdingColReceipts,
            colGross: L.withholdingColGross,
            colWithheld: L.withholdingColWithheld,
            colReceived: L.withholdingColReceived,
            totalRow: L.withholdingTotal,
            empty: L.withholdingEmpty,
          }}
        />
      ) : null}
    </div>
  );
}
