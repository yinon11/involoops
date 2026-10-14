import { readClock } from "@/lib/clock";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import {
  getSandboxMockSetting,
  listReadinessStates,
  listShaamAuthorizations,
} from "@/actions/shaam-actions";
import { SandboxMockCard } from "@/components/admin/shaam/sandbox-mock-card";
import { SendReminderButton } from "@/components/admin/shaam/send-reminder-button";
import { getDictionary } from "@/lib/i18n/server";
import { getShaamConfig } from "@/lib/shaam/client";
import { format } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  ShaamAuthorizationStatus,
  ShaamEnvironment,
} from "@/db/schema/shaam-authorizations";
import { ShaamAuthorizeButton } from "@/components/admin/shaam/authorize-button";
import { ShaamRevokeButton } from "@/components/admin/shaam/revoke-button";
import { ShaamTestConnectionButton } from "@/components/admin/shaam/test-connection-button";
import { ShaamTokenEventsViewer } from "@/components/admin/shaam/token-events-viewer";
import { ShaamEnvSelector } from "@/components/admin/shaam/env-selector";
import { ShieldAlert, CheckCircle2 } from "lucide-react";

export const metadata = {
  title: "ITA integration · Admin",
  robots: { index: false, follow: false },
};

const statusColors: Record<ShaamAuthorizationStatus, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  ACTIVE: "bg-green-100 text-green-800",
  EXPIRED: "bg-amber-100 text-amber-800",
  REVOKED: "bg-red-100 text-red-700",
  ERROR: "bg-red-100 text-red-700",
};

const EXPIRY_WARNING_DAYS = 14;

export default async function AdminShaamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const sp = await searchParams;
  const envFromQuery = firstParam(sp.env);
  const defaultEnv = getShaamConfig().environment;
  const environment: ShaamEnvironment =
    envFromQuery === "UAT" || envFromQuery === "PROD"
      ? (envFromQuery as ShaamEnvironment)
      : defaultEnv;
  const authorizedFlag = firstParam(sp.authorized) === "1";
  const errorCode = firstParam(sp.error);

  const readinessFilter = firstParam(sp.readiness);

  const [dict, rows, readinessRows, { nowMs: now }, sandboxMock] = await Promise.all([
    getDictionary(),
    listShaamAuthorizations({ environment }),
    listReadinessStates(),
    readClock(),
    // Null off the sandbox stack, so production never shows the card.
    getSandboxMockSetting(),
  ]);
  const readinessByEntity = new Map(
    readinessRows.map((r) => [r.businessEntityId, r]),
  );
  const visibleRows = readinessFilter
    ? rows.filter(
        (r) =>
          readinessByEntity.get(r.businessEntityId)?.state === readinessFilter,
      )
    : rows;

  const expiringSoonCount = rows.filter(
    (r) =>
      r.status === "ACTIVE" &&
      r.refreshTokenExpiresAt &&
      new Date(r.refreshTokenExpiresAt).getTime() - now <
        EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{dict.admin.nav.shaam}</h1>
          <p className="text-sm text-gray-500">
            {rows.length} business entities. Environment:{" "}
            <span className="font-mono">{environment}</span>
          </p>
        </div>
        <ShaamEnvSelector current={environment} />
      </div>

      {authorizedFlag && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <CheckCircle2 className="h-4 w-4" />
          {dict.shaam.callback.success}
        </div>
      )}
      {errorCode && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <ShieldAlert className="h-4 w-4" />
          {renderErrorMessage(dict, errorCode, firstParam(sp.detail))}
        </div>
      )}
      {expiringSoonCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="h-4 w-4" />
          {format(dict.shaam.banner.expiringSoon, {
            count: String(expiringSoonCount),
          })}
        </div>
      )}

      {sandboxMock && <SandboxMockCard setting={sandboxMock} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authorizations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Business entity</th>
                <th className="px-4 py-3">Readiness</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Refresh expires</th>
                <th className="px-4 py-3">Last refreshed</th>
                <th className="px-4 py-3">Last error</th>
                <th className="px-4 py-3 text-end">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    No business entities match the current filters.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const isActive = row.status === "ACTIVE";
                  const refreshExpiresIn = row.refreshTokenExpiresAt
                    ? Math.max(
                        0,
                        Math.floor(
                          (new Date(row.refreshTokenExpiresAt).getTime() -
                            now) /
                            (24 * 60 * 60 * 1000),
                        ),
                      )
                    : null;
                  const readiness = readinessByEntity.get(row.businessEntityId);
                  return (
                    <tr key={row.businessEntityId} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.legalName}</div>
                        <div className="font-mono text-[11px] text-gray-500">
                          {row.osekMurshe ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-[11px]">
                          {readiness?.state ?? "GOV_SETUP_REQUIRED"}
                        </Badge>
                        {readiness?.lastConfirmedAt && (
                          <div className="mt-1 text-[11px] text-gray-500">
                            {readiness.lastConfirmedAt.slice(0, 10)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={statusColors[row.status]}>
                          {dict.shaam.status[row.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {refreshExpiresIn !== null ? (
                          <div>
                            <div>
                              {format(dict.shaam.refresh.expiringIn, {
                                days: String(refreshExpiresIn),
                              })}
                            </div>
                            <div className="font-mono text-[11px] text-gray-500">
                              {row.refreshTokenExpiresAt
                                ?.replace("T", " ")
                                .slice(0, 19)}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {row.lastRefreshedAt
                          ?.replace("T", " ")
                          .slice(0, 19) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {row.lastErrorCode ? (
                          <div>
                            <div className="text-red-700">
                              {row.lastErrorCode}
                            </div>
                            <div className="text-gray-500">
                              {row.lastErrorMessage}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {isActive ? (
                            <>
                              <ShaamTestConnectionButton
                                businessEntityId={row.businessEntityId}
                                environment={row.environment}
                                label={dict.shaam.action.test}
                              />
                              <ShaamRevokeButton
                                businessEntityId={row.businessEntityId}
                                environment={row.environment}
                                label={dict.shaam.action.revoke}
                              />
                            </>
                          ) : (
                            <ShaamAuthorizeButton
                              businessEntityId={row.businessEntityId}
                              environment={row.environment}
                              label={
                                row.status === "EXPIRED" ||
                                row.status === "REVOKED"
                                  ? dict.shaam.action.reauthorize
                                  : dict.shaam.action.authorize
                              }
                            />
                          )}
                        </div>
                        <div className="mt-2 flex justify-end gap-2">
                          <SendReminderButton
                            businessEntityId={row.businessEntityId}
                            label="Send reminder"
                          />
                          <ShaamTokenEventsViewer
                            businessEntityId={row.businessEntityId}
                            environment={row.environment}
                          />
                        </div>
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

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}


function renderErrorMessage(
  dict: Awaited<ReturnType<typeof getDictionary>>,
  code: string,
  detail?: string,
): string {
  if (code === "invalid_state") return dict.shaam.callback.error.invalidState;
  if (code === "access_denied") return dict.shaam.callback.error.accessDenied;
  return format(dict.shaam.callback.error.exchangeFailed, {
    detail: detail ?? code,
  });
}
