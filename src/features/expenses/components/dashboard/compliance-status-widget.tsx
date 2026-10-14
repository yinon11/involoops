import Link from "next/link";
import { and, eq, gte, inArray, lte, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import {
  businessEntities,
  shaamAuthorizations,
  outboundInvoices,
  uniformStructureExports,
} from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileDown,
  ShieldCheck,
} from "lucide-react";

/**
 * Spec 11 §9 — admin-only compliance health at a glance.
 * Renders null for non-admin; intended to be mounted from the admin
 * dashboard tab.
 */
export async function ComplianceStatusWidget() {
  const dict = await getDictionary();
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 14 * 86_400_000);

  const [
    entityCount,
    activeAuthCount,
    expiringSoonCount,
    pendingCount,
    lastExports,
  ] = await Promise.all([
    db
      .select({ c: dsql<number>`count(*)::int` })
      .from(businessEntities)
      .then((r) => r[0]?.c ?? 0),
    db
      .select({ c: dsql<number>`count(distinct ${shaamAuthorizations.businessEntityId})::int` })
      .from(shaamAuthorizations)
      .where(eq(shaamAuthorizations.status, "ACTIVE"))
      .then((r) => r[0]?.c ?? 0),
    db
      .select({ c: dsql<number>`count(distinct ${shaamAuthorizations.businessEntityId})::int` })
      .from(shaamAuthorizations)
      .where(
        and(
          eq(shaamAuthorizations.status, "ACTIVE"),
          lte(shaamAuthorizations.refreshTokenExpiresAt, soonCutoff),
          gte(shaamAuthorizations.refreshTokenExpiresAt, now),
        ),
      )
      .then((r) => r[0]?.c ?? 0),
    db
      .select({ c: dsql<number>`count(*)::int` })
      .from(outboundInvoices)
      .where(
        inArray(outboundInvoices.shaamStatus, ["PENDING", "OUTAGE_ISSUED"]),
      )
      .then((r) => r[0]?.c ?? 0),
    db
      .select({
        businessEntityId: uniformStructureExports.businessEntityId,
        completedAt: dsql<Date | string | null>`max(${uniformStructureExports.completedAt})`,
      })
      .from(uniformStructureExports)
      .where(eq(uniformStructureExports.status, "DONE"))
      .groupBy(uniformStructureExports.businessEntityId)
      .then((rows) => rows),
  ]);

  const anyExportEver = lastExports.length > 0;
  // Drizzle does not apply the column's `timestamp → Date` transform when the
  // value comes from a raw SQL aggregate like `max(...)`. postgres-js may
  // hand the value back as either a Date or an ISO-ish string, so coerce
  // defensively before sorting / formatting.
  const mostRecentExport = lastExports
    .map((r) => (r.completedAt == null ? null : new Date(r.completedAt)))
    .filter((d): d is Date => d != null && !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <Card className="border-indigo-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-indigo-700" />
          {dict.dashboard.compliance.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Stat
          icon={<CheckCircle2 className="h-4 w-4 text-green-700" />}
          label={dict.dashboard.compliance.authActive}
          value={`${activeAuthCount} / ${entityCount}`}
          href="/admin/shaam"
        />
        <Stat
          icon={<AlertTriangle className="h-4 w-4 text-amber-700" />}
          label={dict.dashboard.compliance.expiringSoon}
          value={String(expiringSoonCount)}
          href="/admin/shaam"
          accent={expiringSoonCount > 0 ? "amber" : undefined}
        />
        <Stat
          icon={<Clock className="h-4 w-4 text-blue-700" />}
          label={dict.dashboard.compliance.pending}
          value={String(pendingCount)}
          href="/outbound"
          accent={pendingCount > 0 ? "amber" : undefined}
        />
        <Stat
          icon={<FileDown className="h-4 w-4 text-indigo-700" />}
          label={dict.dashboard.compliance.lastExport}
          value={
            mostRecentExport
              ? mostRecentExport.toISOString().slice(0, 10)
              : dict.dashboard.compliance.never
          }
          href="/outbound/uniform-structure"
          accent={!anyExportEver ? "amber" : undefined}
        />
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  href,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href: string;
  accent?: "amber";
}) {
  const accentClass =
    accent === "amber"
      ? "border-amber-300 bg-amber-50"
      : "border-gray-200 bg-white";
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-md border ${accentClass} px-3 py-2 hover:bg-gray-50`}
    >
      <div className="flex items-center gap-2 text-gray-700">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-sm font-semibold">{value}</span>
    </Link>
  );
}
