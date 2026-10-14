import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { listShaamSubmissions } from "@/features/generator/actions/shaam-invoice-actions";
import { getDictionary } from "@/lib/i18n/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "SHAAM submissions · Admin",
  robots: { index: false, follow: false },
};

const statusColors: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-700",
  HELD: "bg-orange-100 text-orange-800",
  TIMEOUT: "bg-amber-100 text-amber-800",
  NETWORK_ERROR: "bg-amber-100 text-amber-800",
  SKIPPED: "bg-gray-100 text-gray-700",
};

export default async function AdminShaamSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const sp = await searchParams;
  const dict = await getDictionary();
  const businessEntityId = firstParam(sp.businessEntityId);
  const documentId = firstParam(sp.documentId);

  const rows = await listShaamSubmissions({
    businessEntityId,
    documentId,
    limit: 200,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SHAAM Submissions</h1>
        <p className="text-sm text-gray-500">
          {rows.length} submissions. Token values are redacted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Env</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Allocation</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    No submissions match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.submittedAt.replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">
                        {row.formattedNumber ?? row.documentId}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.environment}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.actionCode}
                    </td>
                    <td className="px-4 py-3">
                      {row.responseStatus ? (
                        <Badge
                          className={
                            statusColors[row.responseStatus] ??
                            "bg-gray-100 text-gray-700"
                          }
                        >
                          {row.responseStatus}
                        </Badge>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.allocationNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.durationMs !== null ? `${row.durationMs}ms` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.errorCode ? (
                        <div>
                          <div className="font-mono text-red-700">
                            {row.errorCode}
                          </div>
                          <div className="text-gray-600">
                            {row.errorMessage}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <details className="text-[11px]">
                        <summary className="cursor-pointer">
                          request / response
                        </summary>
                        <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-gray-100 p-2 text-[11px]">
                          {JSON.stringify(row.requestPayload, null, 2)}
                        </pre>
                        {row.responsePayload && (
                          <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-gray-100 p-2 text-[11px]">
                            {JSON.stringify(row.responsePayload, null, 2)}
                          </pre>
                        )}
                      </details>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {/* Silence the dict lint if no i18n strings directly reference it here. */}
      <span className="hidden">{dict.admin.nav.shaam}</span>
    </div>
  );
}

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
