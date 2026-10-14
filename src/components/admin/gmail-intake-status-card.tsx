import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import type { GmailIntakeStatus } from "@/actions/gmail-intake-admin-actions";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Props {
  status: GmailIntakeStatus | null;
  /** Server-captured wall clock, so render stays pure. */
  nowMs: number;
}

/**
 * Compact admin card: is Gmail intake healthy? The card's colour is
 * the first thing an operator sees — green means "watch fresh +
 * activity in the last day", amber means "still working but
 * renewal imminent / no recent activity", red means "watch expired
 * or never registered".
 *
 * Paired with the opportunistic-renewal strategy (no cron): if this
 * card goes red, the fix is to run scripts/gmail-watch-register.mjs.
 */
export function GmailIntakeStatusCard({ status, nowMs }: Props) {
  if (!status) return null;

  // Passed in rather than read here: `Date.now()` during render is impure,
  // and a server component that reads the clock mid-render can disagree
  // with itself across a re-render. Same pattern as `shaam-status-panel`.
  const now = nowMs;
  const expiresMs = status.watchExpiresAt?.getTime() ?? 0;
  const hasWatch = !!status.watchExpiresAt;
  const msUntilExpiry = expiresMs - now;
  const daysUntilExpiry = msUntilExpiry / MS_PER_DAY;

  const tone: "ok" | "warn" | "bad" =
    !hasWatch || msUntilExpiry <= 0
      ? "bad"
      : daysUntilExpiry < 2
        ? "warn"
        : "ok";

  const last24hTotal = Object.values(status.last24h).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <Card className={toneBorder(tone)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Gmail intake
          </CardTitle>
          <StatusBadge tone={tone} hasWatch={hasWatch} days={daysUntilExpiry} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row
          label="Mailbox"
          value={status.mailboxEmail ?? <span className="text-muted-foreground">not configured</span>}
        />
        <Row
          label="Watch expires"
          value={
            hasWatch
              ? `${status.watchExpiresAt!.toLocaleString()} (${formatDaysRelative(daysUntilExpiry)})`
              : <span className="text-red-600">never registered — run gmail-watch-register.mjs</span>
          }
        />
        <Row
          label="Last history ID"
          value={
            status.lastHistoryId ?? (
              <span className="text-muted-foreground">none yet</span>
            )
          }
        />
        <Row
          label="Last inbound"
          value={
            status.lastInbound ? (
              <>
                {formatRelative(status.lastInbound.receivedAt)} ·{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {status.lastInbound.outcome}
                </code>
                {status.lastInbound.fromAddress ? (
                  <>
                    {" "}
                    from{" "}
                    <span className="text-muted-foreground">
                      {status.lastInbound.fromAddress}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">nothing yet</span>
            )
          }
        />
        {last24hTotal > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs text-muted-foreground">Last 24h:</span>
            {Object.entries(status.last24h)
              .sort((a, b) => b[1] - a[1])
              .map(([outcome, count]) => (
                <Badge
                  key={outcome}
                  variant={outcome === "accepted" ? "default" : "secondary"}
                  className="text-xs"
                >
                  {outcome} · {count}
                </Badge>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  );
}

function StatusBadge({
  tone,
  hasWatch,
  days,
}: {
  tone: "ok" | "warn" | "bad";
  hasWatch: boolean;
  days: number;
}) {
  if (tone === "bad") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        {hasWatch ? "Expired" : "Not registered"}
      </Badge>
    );
  }
  if (tone === "warn") {
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100">
        <Clock className="h-3 w-3" />
        Renewing soon
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
      <CheckCircle2 className="h-3 w-3" />
      {Math.floor(days)}d left
    </Badge>
  );
}

function toneBorder(tone: "ok" | "warn" | "bad"): string {
  switch (tone) {
    case "bad":
      return "border-red-300";
    case "warn":
      return "border-amber-300";
    default:
      return "";
  }
}

function formatDaysRelative(days: number): string {
  if (days < 0) return "expired";
  if (days < 1) {
    const hours = Math.max(0, Math.floor(days * 24));
    return `in ${hours}h`;
  }
  return `in ${Math.floor(days)}d`;
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
