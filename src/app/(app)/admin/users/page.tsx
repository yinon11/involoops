import { readClock } from "@/lib/clock";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { getAdminUserAnalytics } from "@/actions/admin-analytics-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UserAnalyticsTable } from "@/components/admin/user-analytics/user-analytics-table";
import { AdminAddUserForm } from "@/components/admin/admin-add-user-form";
import { GmailIntakeStatusCard } from "@/components/admin/gmail-intake-status-card";
import { getGmailIntakeStatus } from "@/actions/gmail-intake-admin-actions";

export const metadata = {
  title: "User analytics · Admin",
  robots: { index: false, follow: false },
};

function formatRelative(d: Date | string | null): string {
  if (!d) return "Never";
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const [data, gmailIntakeStatus] = await Promise.all([
    getAdminUserAnalytics(),
    getGmailIntakeStatus(),
  ]);
  if (!data) {
    notFound();
  }

  const { overview, users, topUsersByInvoices, topUsersThisMonth, recentlyActiveUsers } =
    data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User analytics</h1>
        <p className="text-sm text-muted-foreground">
          Admin-only view of sign-ups, usage, and activity across every account.
        </p>
      </div>

      <GmailIntakeStatusCard
        status={gmailIntakeStatus}
        nowMs={(await readClock()).nowMs}
      />

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total users"
          value={overview.totalUsers.toLocaleString()}
          sub={`${overview.adminUsers} admin${overview.adminUsers === 1 ? "" : "s"}`}
        />
        <StatCard
          label="New this month"
          value={overview.newUsersThisMonth.toLocaleString()}
          sub="sign-ups since the 1st"
        />
        <StatCard
          label="Active last 7d"
          value={overview.activeUsers7d.toLocaleString()}
          sub={`${overview.activeUsers30d.toLocaleString()} in last 30d`}
        />
        <StatCard
          label="Total invoices"
          value={overview.totalInvoices.toLocaleString()}
          sub={`${overview.invoicesThisMonth.toLocaleString()} this month`}
        />
        <StatCard
          label="LLM cost (all time)"
          value={formatCost(overview.totalLlmCostUsd)}
          sub="sum of invoices.llm_cost_usd"
        />
      </div>

      {/* Leaderboards */}
      <div className="grid gap-4 lg:grid-cols-3">
        <LeaderboardCard
          title="Top users by total invoices"
          description="All-time invoice count."
          entries={topUsersByInvoices.map((u) => ({
            id: u.id,
            primary: u.name ?? u.email,
            secondary: u.name ? u.email : null,
            value: u.totalInvoices.toLocaleString(),
          }))}
          emptyLabel="No invoice activity yet."
        />
        <LeaderboardCard
          title="Top this month"
          description="Current-month usage from usage_tracking."
          entries={topUsersThisMonth.map((u) => ({
            id: u.id,
            primary: u.name ?? u.email,
            secondary: u.name ? u.email : null,
            value: u.currentMonthUsage.toLocaleString(),
          }))}
          emptyLabel="No activity this month."
        />
        <LeaderboardCard
          title="Recently active"
          description="Most recent invoice updates."
          entries={recentlyActiveUsers.map((u) => ({
            id: u.id,
            primary: u.name ?? u.email,
            secondary: u.name ? u.email : null,
            value: formatRelative(u.lastActivityAt),
          }))}
          emptyLabel="No activity recorded."
        />
      </div>

      {/* Full table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All users</CardTitle>
          <CardDescription>
            Click any column header to sort. Usage resets on the 1st of each month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserAnalyticsTable rows={users} currentAdminId={session.user.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Provision account</CardTitle>
          <CardDescription>
            Create a credentials-based account from here without going through
            self sign-up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminAddUserForm />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">
          {label}
        </CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      )}
    </Card>
  );
}

function LeaderboardCard({
  title,
  description,
  entries,
  emptyLabel,
}: {
  title: string;
  description: string;
  entries: Array<{
    id: string;
    primary: string;
    secondary: string | null;
    value: string;
  }>;
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ol className="space-y-2">
            {entries.map((e, idx) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-4 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                    {idx + 1}.
                  </span>
                  <div className="min-w-0">
                    <div className="truncate">{e.primary}</div>
                    {e.secondary && (
                      <div className="truncate text-xs text-muted-foreground">
                        {e.secondary}
                      </div>
                    )}
                  </div>
                </div>
                <span className="shrink-0 font-medium tabular-nums">
                  {e.value}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
