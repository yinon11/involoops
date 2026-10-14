import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { listArchiveObjects } from "@/features/generator/actions/archive-actions";
import { getDictionary } from "@/lib/i18n/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArchiveFilters } from "@/components/admin/archive/archive-filters";
import { ArchiveObjectVerifyButton } from "@/components/admin/archive/verify-button";
import { ArchiveDownloadButton } from "@/components/admin/archive/download-button";
import type { ArchiveObjectKind } from "@/db/schema/archive-objects";

export const metadata = {
  title: "Archive · Admin",
  robots: { index: false, follow: false },
};

export default async function AdminArchivePage({
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
  const from = firstParam(sp.from);
  const to = firstParam(sp.to);

  const { rows } = await listArchiveObjects({
    businessEntityId,
    documentId,
    from,
    to,
    limit: 200,
  });

  const totalBytes = rows.reduce((sum, r) => sum + r.contentLength, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{dict.admin.nav.archive}</h1>
        <p className="text-sm text-gray-500">
          {rows.length} objects · {formatBytes(totalBytes)} ·{" "}
          {dict.archive.retentionYears}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <ArchiveFilters
            initialBusinessEntityId={businessEntityId ?? ""}
            initialDocumentId={documentId ?? ""}
            initialFrom={from ?? ""}
            initialTo={to ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Stored</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Seq</th>
                <th className="px-4 py-3">Hash</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No archived objects match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.storedAt
                        .toISOString()
                        .replace("T", " ")
                        .slice(0, 19)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">
                        {row.formattedNumber ?? row.documentId}
                      </div>
                      {row.documentType && (
                        <div className="text-[11px] text-gray-500">
                          {
                            dict.documents.type[
                              row.documentType as keyof typeof dict.documents.type
                            ]
                          }
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.ownerEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="secondary"
                        className="bg-indigo-50 text-indigo-700"
                      >
                        {dict.archive.object[
                          row.objectKind as ArchiveObjectKind
                        ] ?? row.objectKind}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {formatBytes(row.contentLength)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.chainSequence}
                    </td>
                    <td
                      className="px-4 py-3 font-mono text-[11px]"
                      title={row.contentSha256}
                    >
                      {row.contentSha256.slice(0, 12)}…
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <ArchiveObjectVerifyButton archiveObjectId={row.id} />
                        <ArchiveDownloadButton
                          documentId={row.documentId}
                          objectKind={row.objectKind}
                        />
                      </div>
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

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
