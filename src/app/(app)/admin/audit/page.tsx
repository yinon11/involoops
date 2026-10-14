import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { listAuditEntries, type AuditListRow } from "@/actions/audit-actions";
import { getDictionary } from "@/lib/i18n/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AuditChainVerifyButton } from "@/components/admin/audit/chain-verify-button";
import { AuditExportButton } from "@/components/admin/audit/export-button";
import { AuditFilters } from "@/components/admin/audit/audit-filters";
import type { AuditEventType } from "@/db/schema";
import { auditEventDisplayLabel } from "@/lib/audit/event-label";

export const metadata = {
  title: "Audit log · Admin",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 100;

const EVENT_TYPES: AuditEventType[] = [
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "VOIDED",
  "SIGNED",
  "ARCHIVED",
  "SHAAM_SUBMITTED",
  "SHAAM_ALLOCATION_RECEIVED",
  "SHAAM_REJECTED",
  "SHAAM_REJECTION_RESOLVED",
  "PDF_GENERATED",
  "VIEWED",
  "EXPORTED",
  "CREDIT_NOTE_ISSUED",
  "REVERSE_CHARGE_CONSENT_REQUESTED",
  "REVERSE_CHARGE_CONSENT_SIGNED",
  "REVERSE_CHARGE_APPLIED",
  "REVERSE_CHARGE_REMOVED",
  "CASH_CEILING_EXCEEDED",
];

function isAuditEventType(value: string): value is AuditEventType {
  return (EVENT_TYPES as string[]).includes(value);
}

export default async function AdminAuditPage({
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

  const userIdFilter = firstParam(sp.userId);
  const businessEntityIdFilter = firstParam(sp.businessEntityId);
  const documentIdFilter = firstParam(sp.documentId);
  const fromFilter = firstParam(sp.from);
  const toFilter = firstParam(sp.to);
  const rawEventTypes = Array.isArray(sp.eventType)
    ? sp.eventType
    : sp.eventType
      ? [sp.eventType]
      : [];
  const eventTypes = rawEventTypes.filter(isAuditEventType);
  const page = Math.max(1, Number(firstParam(sp.page) ?? 1));

  const filters = {
    userId: userIdFilter,
    businessEntityId: businessEntityIdFilter,
    documentId: documentIdFilter,
    eventTypes: eventTypes.length ? eventTypes : undefined,
    from: fromFilter,
    to: toFilter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const { rows, total } = await listAuditEntries(filters);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{dict.nav.audit}</h1>
          <p className="text-sm text-gray-500">
            Append-only document audit log. {total} matching{" "}
            {total === 1 ? "entry" : "entries"}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {businessEntityIdFilter && (
            <AuditChainVerifyButton
              businessEntityId={businessEntityIdFilter}
            />
          )}
          <AuditExportButton filters={filters} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditFilters
            initialUserId={userIdFilter ?? ""}
            initialBusinessEntityId={businessEntityIdFilter ?? ""}
            initialDocumentId={documentIdFilter ?? ""}
            initialFrom={fromFilter ?? ""}
            initialTo={toFilter ?? ""}
            initialEventTypes={eventTypes}
            allEventTypes={EVENT_TYPES}
            eventLabels={dict.audit.event}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Seq</th>
                <th className="px-4 py-3">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No entries match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => <AuditRow key={row.id} row={row} dict={dict} />)
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function AuditRow({
  row,
  dict,
}: {
  row: AuditListRow;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  return (
    <tr className="align-top hover:bg-gray-50">
      <td className="px-4 py-3 font-mono text-xs">
        {row.createdAt.toISOString().replace("T", " ").slice(0, 19)}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{row.userEmail ?? "[deleted user]"}</div>
        <div className="font-mono text-[11px] text-gray-400">{row.userId}</div>
      </td>
      <td className="px-4 py-3">
        <div>{row.actorEmail ?? "[deleted user]"}</div>
        {row.actorUserId !== row.userId && (
          <div className="text-[11px] text-amber-600">(on-behalf)</div>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">
          {auditEventDisplayLabel(row.eventType, row.eventPayload, dict.audit)}
        </Badge>
        <details className="mt-1 text-[11px] text-gray-500">
          <summary className="cursor-pointer">payload</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-[11px]">
            {JSON.stringify(row.eventPayload, null, 2)}
          </pre>
        </details>
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-xs">{row.formattedNumber ?? "—"}</div>
        <div className="font-mono text-[11px] text-gray-400">
          {row.documentId}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs">{row.sequenceNumber}</td>
      <td className="px-4 py-3 font-mono text-[11px]" title={row.entryHash}>
        {row.entryHashShort}…
      </td>
    </tr>
  );
}

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
