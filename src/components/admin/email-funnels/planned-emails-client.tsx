"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  CalendarClock,
  RefreshCw,
  Loader2,
  Eye,
  Mail,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import type {
  AdminPlannedEmail,
  AdminFunnelGroup,
  PlannedEmailPreview,
} from "@/actions/email-funnel-admin-actions";
import {
  getPlannedEmails,
  getPlannedEmailPreview,
} from "@/actions/email-funnel-admin-actions";
import { ExportXlsxButton } from "@/components/shared/export-xlsx-button";

interface Props {
  initialPlanned: AdminPlannedEmail[];
  groups: AdminFunnelGroup[];
}

function formatDelay(hours: number): string {
  if (hours === 0) return "Immediately";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

function timeUntil(d: Date): string {
  const now = new Date();
  const target = new Date(d);
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "Due now";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h`;
  }
  return hours > 0 ? `in ${hours}h ${mins}m` : `in ${mins}m`;
}

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

export function PlannedEmailsClient({ initialPlanned, groups }: Props) {
  const [planned, setPlanned] = useState(initialPlanned);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [isPending, startTransition] = useTransition();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PlannedEmailPreview | null>(null);
  const [previewTab, setPreviewTab] = useState<"html" | "text" | "vars">(
    "html",
  );
  const [previewContext, setPreviewContext] = useState<{
    userId: string;
    funnelCode: string;
  } | null>(null);

  async function handleRefresh() {
    startTransition(async () => {
      const data = await getPlannedEmails(
        groupFilter !== "all" ? { funnelGroup: groupFilter } : undefined,
      );
      setPlanned(data);
    });
  }

  async function handleGroupChange(value: string) {
    setGroupFilter(value);
    startTransition(async () => {
      const data = await getPlannedEmails(
        value !== "all" ? { funnelGroup: value } : undefined,
      );
      setPlanned(data);
    });
  }

  async function openPreview(userId: string, funnelCode: string) {
    setPreview(null);
    setPreviewTab("html");
    setPreviewContext({ userId, funnelCode });
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const data = await getPlannedEmailPreview(userId, funnelCode);
      setPreview(data);
    } finally {
      setPreviewLoading(false);
    }
  }

  const groupColors: Record<string, string> = {};
  for (const g of groups) {
    groupColors[g.key] = g.color;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" />
            Planned Emails ({planned.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={groupFilter} onValueChange={handleGroupChange}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.key} value={g.key}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <ExportXlsxButton
              rows={() =>
                planned.map((p) => ({
                  "User Email": p.userEmail ?? "",
                  "User Name": p.userName ?? "",
                  "Funnel Code": p.funnelCode ?? "",
                  "Funnel Name": p.funnelName ?? "",
                  Group: p.funnelGroup ?? "",
                  "Current Step": p.currentStep ?? 0,
                  "Next Step": p.nextStepNumber ?? 0,
                  "Next Template": p.nextStepTemplateName ?? "",
                  "Next Subject": p.nextStepSubject ?? "",
                  "Scheduled At": p.nextEmailAt
                    ? new Date(p.nextEmailAt).toISOString()
                    : "",
                  "Delay (hours)": p.delayHours ?? 0,
                }))
              }
              filename="planned-emails"
              sheetName="Planned Emails"
              disabled={planned.length === 0}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {planned.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No planned emails.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">User</TableHead>
                <TableHead className="text-xs">Funnel</TableHead>
                <TableHead className="text-xs">Group</TableHead>
                <TableHead className="text-xs">Step</TableHead>
                <TableHead className="text-xs">Next Template</TableHead>
                <TableHead className="text-xs">Scheduled</TableHead>
                <TableHead className="text-xs">Delay</TableHead>
                <TableHead className="text-xs text-end"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planned.map((p, idx) => {
                const journeyHref = `/admin/email-funnels?userId=${encodeURIComponent(
                  p.userId,
                )}`;
                return (
                  <TableRow key={`${p.userId}-${p.funnelCode}-${idx}`}>
                    <TableCell className="text-xs">
                      <Link
                        href={journeyHref}
                        className="block hover:underline"
                        title="Open this user's full funnel journey"
                      >
                        <p className="font-medium">{p.userEmail}</p>
                        {p.userName && (
                          <p className="text-muted-foreground">{p.userName}</p>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      <Link
                        href={journeyHref}
                        className="hover:underline"
                        title="Open this user's full funnel journey"
                      >
                        {p.funnelName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          borderColor: groupColors[p.funnelGroup],
                          color: groupColors[p.funnelGroup],
                        }}
                      >
                        {p.funnelGroup}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.currentStep} → {p.nextStepNumber}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Link
                        href={journeyHref}
                        className="block hover:underline"
                        title="Open this user's full funnel journey"
                      >
                        <p>{p.nextStepTemplateName}</p>
                        <p className="text-muted-foreground">
                          {p.nextStepSubject}
                        </p>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>
                        <p>{timeUntil(p.nextEmailAt)}</p>
                        <p className="text-muted-foreground">
                          {new Date(p.nextEmailAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDelay(p.delayHours)}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openPreview(p.userId, p.funnelCode)}
                        title="Preview the rendered email in the user's language"
                      >
                        <Eye className="me-1 h-4 w-4" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Planned email preview
            </DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview ? (
            <div className="flex flex-1 flex-col gap-3 overflow-hidden">
              <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 text-xs">
                <div>
                  <span className="font-semibold text-muted-foreground">
                    To:
                  </span>{" "}
                  <span>
                    {preview.recipientEmail}
                    {preview.userName ? ` (${preview.userName})` : ""}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Scheduled:
                  </span>{" "}
                  <span>{formatDateTime(preview.scheduledAt)}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold text-muted-foreground">
                    Subject:
                  </span>{" "}
                  <span>{preview.subject}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold text-muted-foreground">
                    Funnel:
                  </span>{" "}
                  <span className="font-mono">{preview.funnelCode}</span>{" "}
                  <span className="text-muted-foreground">
                    {preview.funnelName}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}· step {preview.stepNumber}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Template:
                  </span>{" "}
                  <span className="font-mono">{preview.templateCode}</span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Language:
                  </span>{" "}
                  <Badge variant="outline" className="text-[10px]">
                    {preview.resolvedLocale}
                  </Badge>
                  {preview.localeFallback && (
                    <span className="ms-2 text-amber-700">
                      (no {preview.requestedLocale} translation – fell back to
                      English)
                    </span>
                  )}
                </div>
              </div>

              {preview.localeFallback && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    User&apos;s preferred language is{" "}
                    <code className="font-mono">{preview.requestedLocale}</code>
                    , but no template row exists for that locale. The send will
                    fall back to English.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1 border-b">
                  {(["html", "text", "vars"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setPreviewTab(k)}
                      className={`px-3 py-1.5 text-sm font-medium ${
                        previewTab === k
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
                {previewContext && (
                  <Link
                    href={`/admin/email-funnels?userId=${encodeURIComponent(
                      previewContext.userId,
                    )}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open user&apos;s funnel journey
                  </Link>
                )}
              </div>

              <div className="flex-1 overflow-auto rounded-md border bg-white">
                {previewTab === "html" ? (
                  <iframe
                    srcDoc={preview.html}
                    className="h-[460px] w-full"
                    title="Email body"
                    sandbox=""
                  />
                ) : previewTab === "text" ? (
                  <pre className="whitespace-pre-wrap p-4 text-sm text-gray-700">
                    {preview.text || "No plain text version."}
                  </pre>
                ) : (
                  <pre className="whitespace-pre-wrap p-4 text-xs text-gray-700">
                    {JSON.stringify(preview.variables, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Could not load preview — the user may no longer be in this funnel.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
