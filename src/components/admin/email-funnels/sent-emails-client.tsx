"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Send,
  Search,
  Loader2,
  Eye,
  Mail,
  AlertTriangle,
  MousePointerClick,
} from "lucide-react";
import type {
  AdminSentEmail,
  AdminFunnelOption,
  SentEmailsPage,
  SentEmailDetails,
  SentEmailsEngagement,
} from "@/actions/email-funnel-admin-actions";
import {
  listSentEmails,
  getSentEmailDetails,
} from "@/actions/email-funnel-admin-actions";

interface Props {
  initialPage: SentEmailsPage;
  funnels: AdminFunnelOption[];
}

const STATUS_OPTIONS = [
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
] as const;

// Engagement is orthogonal to lifecycle status — see comment on
// `SentEmailsEngagement` in the server action for the rationale.
const ENGAGEMENT_OPTIONS: ReadonlyArray<{
  value: SentEmailsEngagement;
  label: string;
}> = [
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "none", label: "Delivered, no engagement" },
];

const PAGE_SIZE = 50;

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "delivered":
      return "bg-green-100 text-green-800 border-green-200";
    case "sent":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "pending":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "bounced":
    case "complained":
    case "failed":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

export function SentEmailsClient({ initialPage, funnels }: Props) {
  const [rows, setRows] = useState<AdminSentEmail[]>(initialPage.rows);
  const [total, setTotal] = useState<number>(initialPage.total);
  const [offset, setOffset] = useState<number>(initialPage.offset);

  const [search, setSearch] = useState("");
  const [funnelId, setFunnelId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [engagement, setEngagement] = useState<string>("all");

  const [isPending, startTransition] = useTransition();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [details, setDetails] = useState<SentEmailDetails | null>(null);
  const [detailsTab, setDetailsTab] = useState<"html" | "text" | "vars">(
    "html",
  );

  function activeFilters() {
    return {
      search: search.trim() || undefined,
      funnelId: funnelId === "all" ? undefined : funnelId,
      status: status === "all" ? undefined : status,
      engagement:
        engagement === "all"
          ? undefined
          : (engagement as SentEmailsEngagement),
    };
  }

  async function loadPage(nextOffset: number) {
    startTransition(async () => {
      const page = await listSentEmails({
        ...activeFilters(),
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setRows(page.rows);
      setTotal(page.total);
      setOffset(page.offset);
    });
  }

  async function handleApplyFilters() {
    await loadPage(0);
  }

  async function handleClearFilters() {
    setSearch("");
    setFunnelId("all");
    setStatus("all");
    setEngagement("all");
    startTransition(async () => {
      const page = await listSentEmails({ limit: PAGE_SIZE, offset: 0 });
      setRows(page.rows);
      setTotal(page.total);
      setOffset(0);
    });
  }

  async function openDetails(logId: string) {
    setDetails(null);
    setDetailsTab("html");
    setDetailsOpen(true);
    setDetailsLoading(true);
    try {
      const data = await getSentEmailDetails(logId);
      setDetails(data);
    } finally {
      setDetailsLoading(false);
    }
  }

  const showingStart = rows.length === 0 ? 0 : offset + 1;
  const showingEnd = offset + rows.length;
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4" />
              Sent emails ({total.toLocaleString()})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="ps-8"
                placeholder="Recipient, name, or subject"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApplyFilters();
                }}
              />
            </div>
            <Select value={funnelId} onValueChange={setFunnelId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All funnels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All funnels</SelectItem>
                {funnels.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.code} · {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={engagement} onValueChange={setEngagement}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Any engagement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any engagement</SelectItem>
                {ENGAGEMENT_OPTIONS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleApplyFilters} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Apply"
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearFilters}
              disabled={isPending}
            >
              Clear
            </Button>
          </div>

          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No emails found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Sent</TableHead>
                  <TableHead className="text-xs">Recipient</TableHead>
                  <TableHead className="text-xs">Funnel</TableHead>
                  <TableHead className="text-xs">Step</TableHead>
                  <TableHead className="text-xs">Subject</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead
                    className="text-xs whitespace-nowrap"
                    title="Opens · Clicks reported by SES (open count · unique clicks)"
                  >
                    Engagement
                  </TableHead>
                  <TableHead
                    className="text-xs text-end whitespace-nowrap"
                    title="Total emails (transactional + funnel) ever sent to this user"
                  >
                    Total to user
                  </TableHead>
                  <TableHead className="text-xs text-end"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDateTime(r.sentAt ?? r.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {r.recipientEmail}
                        </p>
                        {r.userName && (
                          <p className="truncate text-muted-foreground">
                            {r.userName}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.funnelCode ? (
                        <span>
                          <span className="font-mono text-muted-foreground">
                            {r.funnelCode}
                          </span>{" "}
                          {r.funnelName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {r.templateName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.funnelStep ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs max-w-[360px]">
                      <p className="truncate">{r.subject ?? ""}</p>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] capitalize ${statusBadgeClass(r.status)}`}
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <EngagementCell
                        openCount={r.openCount}
                        clickCount={r.clickCount}
                        openedAt={r.openedAt}
                        clickedAt={r.clickedAt}
                      />
                    </TableCell>
                    <TableCell
                      className="text-xs text-end font-mono tabular-nums"
                      title="Total emails (transactional + funnel) ever sent to this user"
                    >
                      {r.userTotalSent.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDetails(r.id)}
                      >
                        <Eye className="me-1 h-4 w-4" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {total > 0 && (
            <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
              <span>
                Showing {showingStart.toLocaleString()}–
                {showingEnd.toLocaleString()} of {total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canPrev || isPending}
                  onClick={() => loadPage(Math.max(offset - PAGE_SIZE, 0))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canNext || isPending}
                  onClick={() => loadPage(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Sent email
            </DialogTitle>
          </DialogHeader>
          {detailsLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : details ? (
            <div className="flex flex-1 flex-col gap-3 overflow-hidden">
              <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 text-xs">
                <div>
                  <span className="font-semibold text-muted-foreground">
                    To:
                  </span>{" "}
                  <span>
                    {details.recipientEmail}
                    {details.userName ? ` (${details.userName})` : ""}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Status:
                  </span>{" "}
                  <span className="capitalize">{details.status}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold text-muted-foreground">
                    Subject:
                  </span>{" "}
                  <span>{details.subject}</span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Sent:
                  </span>{" "}
                  <span>{formatDateTime(details.sentAt)}</span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Delivered:
                  </span>{" "}
                  <span>{formatDateTime(details.deliveredAt)}</span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Opened:
                  </span>{" "}
                  <span>{formatDateTime(details.openedAt)}</span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Clicked:
                  </span>{" "}
                  <span>{formatDateTime(details.clickedAt)}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold text-muted-foreground">
                    Template:
                  </span>{" "}
                  <span className="font-mono">{details.templateCode}</span>
                  {details.funnelCode && (
                    <>
                      {" · "}
                      <span className="font-semibold text-muted-foreground">
                        Funnel:
                      </span>{" "}
                      <span className="font-mono">{details.funnelCode}</span>
                      {details.funnelStep != null && (
                        <span className="text-muted-foreground">
                          {" "}step {details.funnelStep}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {details.sesMessageId && (
                  <div className="col-span-2">
                    <span className="font-semibold text-muted-foreground">
                      SES message id:
                    </span>{" "}
                    <span className="font-mono text-[11px]">
                      {details.sesMessageId}
                    </span>
                  </div>
                )}
                {details.errorMessage && (
                  <div className="col-span-2 text-red-700">
                    <span className="font-semibold">Error:</span>{" "}
                    {details.errorMessage}
                  </div>
                )}
              </div>

              {details.reconstructed && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Stored variables couldn&apos;t be parsed — body is shown
                    without variable substitution.
                  </span>
                </div>
              )}

              <div className="flex gap-1 border-b">
                {(["html", "text", "vars"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setDetailsTab(k)}
                    className={`px-3 py-1.5 text-sm font-medium ${
                      detailsTab === k
                        ? "border-b-2 border-primary text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    {k === "html"
                      ? "HTML"
                      : k === "text"
                        ? "Plain text"
                        : "Variables"}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-auto rounded-md border bg-white">
                {detailsTab === "html" ? (
                  <iframe
                    srcDoc={details.html}
                    className="h-[460px] w-full"
                    title="Email body"
                    sandbox=""
                  />
                ) : detailsTab === "text" ? (
                  <pre className="whitespace-pre-wrap p-4 text-sm text-gray-700">
                    {details.text || "No plain text version."}
                  </pre>
                ) : (
                  <pre className="whitespace-pre-wrap p-4 text-xs text-gray-700">
                    {JSON.stringify(details.variables, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Email not found.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Compact engagement readout for the table row. Hides counts entirely
 * when there's been zero engagement so the column doesn't visually
 * scream "0 0 0 0" for every row in batches that just landed and
 * haven't been opened yet.
 *
 * Tooltip carries the raw timestamps so admins can drill into the
 * details drawer or the SES console with a starting point.
 */
function EngagementCell({
  openCount,
  clickCount,
  openedAt,
  clickedAt,
}: {
  openCount: number;
  clickCount: number;
  openedAt: Date | null;
  clickedAt: Date | null;
}) {
  if (openCount === 0 && clickCount === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const tooltip = [
    openedAt ? `First open: ${formatDateTime(openedAt)}` : null,
    clickedAt ? `First click: ${formatDateTime(clickedAt)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className="inline-flex items-center gap-2 font-mono tabular-nums"
      title={tooltip || undefined}
    >
      <span
        className={
          openCount > 0
            ? "inline-flex items-center gap-1 text-emerald-700"
            : "inline-flex items-center gap-1 text-muted-foreground"
        }
      >
        <Eye className="h-3.5 w-3.5" />
        {openCount}
      </span>
      <span
        className={
          clickCount > 0
            ? "inline-flex items-center gap-1 text-indigo-700"
            : "inline-flex items-center gap-1 text-muted-foreground"
        }
      >
        <MousePointerClick className="h-3.5 w-3.5" />
        {clickCount}
      </span>
    </span>
  );
}
