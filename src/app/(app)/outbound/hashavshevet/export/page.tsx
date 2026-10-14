import { FileDown } from "lucide-react";
import { requireGeneratorAccess } from "@/lib/features/require-generator-access";
import { getDictionary } from "@/lib/i18n/server";
import {
  getMoveinExportSettings,
  listMoveinExports,
} from "@/features/generator/actions/movein-export-actions";
import { validateCardMappingComplete } from "@/lib/hashavshevet-movein/settings-mapper";
import { HashavshevetTabs } from "@/features/generator/components/hashavshevet/hashavshevet-tabs";
import { MoveinExportForm } from "@/features/generator/components/hashavshevet/export-form";
import { MoveinDownloadButton } from "@/features/generator/components/hashavshevet/download-button";
import { HashavshevetBusinessSetupPrompt } from "@/features/generator/components/hashavshevet/business-setup-prompt";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Hashavshevet Export — InvoLoops Studio",
  robots: { index: false, follow: false },
};

const statusColors: Record<string, string> = {
  DONE: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-700",
};

export default async function HashavshevetExportPage() {
  const session = await requireGeneratorAccess();
  const dict = await getDictionary();
  const businessEntity = await getBusinessEntityForUserOrNull(session.user.id);

  let settingsComplete = false;
  let rows: Awaited<ReturnType<typeof listMoveinExports>> = [];
  if (businessEntity) {
    const settings = await getMoveinExportSettings();
    rows = await listMoveinExports();
    settingsComplete =
      validateCardMappingComplete({
        generalCash: settings.generalCash,
        creditCardCash: settings.creditCardCash,
        cash: settings.cash,
        checkCash: settings.checkCash,
        transferUsd: settings.transferUsd,
        transferEur: settings.transferEur,
        transferGbp: settings.transferGbp,
        transferJpy: settings.transferJpy,
        paypal: settings.paypal,
        bit: settings.bit,
        pepper: settings.pepper,
        credit: settings.credit,
        purchase: settings.purchase,
        inputVat: settings.inputVat,
        withholdingTax: settings.withholdingTax,
        outputVat: settings.outputVat,
        income: settings.income,
        exemptIncome: settings.exemptIncome,
        cashCustomer: settings.cashCustomer,
      }).length === 0;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
          <FileDown className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{dict.hashavshevet.exportPageTitle}</h1>
          <p className="text-sm text-zinc-500">{dict.hashavshevet.exportPageSubline}</p>
        </div>
      </div>

      <HashavshevetTabs />
      {!businessEntity ? (
        <HashavshevetBusinessSetupPrompt
          title={dict.hashavshevet.setupBusinessEntityTitle}
          body={dict.hashavshevet.setupBusinessEntityBody}
          cta={dict.hashavshevet.setupBusinessEntityCta}
        />
      ) : (
        <MoveinExportForm settingsComplete={settingsComplete} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{dict.hashavshevet.pastExports}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-start text-xs font-medium uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Run</th>
                <th className="px-4 py-3">{dict.hashavshevet.period}</th>
                <th className="px-4 py-3">{dict.hashavshevet.status}</th>
                <th className="px-4 py-3">{dict.hashavshevet.counts}</th>
                <th className="px-4 py-3 text-end">{dict.hashavshevet.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    {dict.hashavshevet.noExports}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.runId} className="align-top hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.runId}</td>
                    <td className="px-4 py-3 text-xs">
                      {row.periodStart} → {row.periodEnd}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          statusColors[row.status] ??
                          "bg-zinc-100 text-zinc-700"
                        }
                      >
                        {dict.hashavshevet.statusLabels[row.status] ?? row.status}
                      </Badge>
                      {row.errorMessage && (
                        <div className="mt-1 text-[11px] text-red-700">
                          {row.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.invoiceCount ?? "—"} / {row.movementCount ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {row.downloadHref && (
                        <MoveinDownloadButton
                          href={row.downloadHref}
                          label={dict.hashavshevet.download}
                        />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
