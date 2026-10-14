import { getDictionary } from "@/lib/i18n/server";
import { listMyUniformStructureExports } from "@/features/generator/actions/uniform-structure-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewExportForm } from "@/components/admin/uniform-structure/new-export-form";
import { ExportDownloadButton } from "@/components/admin/uniform-structure/download-button";
import { ExportPrintLinks } from "./export-print-links";
import { Pcn874Card } from "./pcn874-card";

const statusColors: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  RUNNING: "bg-blue-100 text-blue-700",
  DONE: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-700",
};

export async function UniformStructurePanel() {
  const dict = await getDictionary();
  const u = dict.uniformStructure;
  const rows = await listMyUniformStructureExports();

  return (
    <div className="space-y-6">
      <NewExportForm />

      <Pcn874Card />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{u.pastExports}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">{u.runId}</th>
                <th className="px-4 py-3">{u.periodStart}</th>
                <th className="px-4 py-3">{u.statusColumn}</th>
                <th className="px-4 py-3">{u.recordCounts}</th>
                <th className="px-4 py-3 text-end">{u.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    {u.noExportsYet}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const stats = row.stats as
                    | { recordCounts?: Record<string, number> }
                    | null;
                  const total = stats?.recordCounts?.TOTAL ?? null;
                  return (
                    <tr key={row.runId} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{row.runId}</td>
                      <td className="px-4 py-3 text-xs">
                        {row.periodStart} → {row.periodEnd}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            statusColors[row.status] ??
                            "bg-gray-100 text-gray-700"
                          }
                        >
                          {u.status[row.status] ?? row.status}
                        </Badge>
                        {row.errorMessage && (
                          <div className="mt-1 text-[11px] text-red-700">
                            {row.errorMessage}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {total !== null ? total : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {row.status === "DONE" && row.zipKey && (
                          <div className="flex flex-col items-end gap-2">
                            <ExportDownloadButton
                              runId={row.runId}
                              label={u.download}
                            />
                            <ExportPrintLinks
                              runId={row.runId}
                              section26Label={u.printSection26}
                              appendix54Label={u.printAppendix54}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
