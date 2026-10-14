"use client";

import { useMemo, useState, useTransition } from "react";
import { LogIn } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { impersonateUserAction } from "@/actions/admin-impersonate-actions";
import type { AdminAnalyticsUserRow } from "@/actions/admin-analytics-actions";

type SortKey =
  | "email"
  | "createdAt"
  | "tier"
  | "currentMonthUsage"
  | "totalInvoices"
  | "vendorCount"
  | "totalLlmCostUsd"
  | "lastActivityAt";

interface Props {
  rows: AdminAnalyticsUserRow[];
  /** Current admin's user id — hides the impersonate button on their own row. */
  currentAdminId: string;
}

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

export function UserAnalyticsTable({ rows, currentAdminId }: Props) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastActivityAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pendingImpersonationId, setPendingImpersonationId] = useState<
    string | null
  >(null);
  const [, startImpersonation] = useTransition();

  const handleImpersonate = (target: AdminAnalyticsUserRow) => {
    const label = target.email ?? target.name ?? "this user";
    const ok = window.confirm(
      `Sign in as ${label}?\n\n` +
        `Your admin session will be paused. Use the avatar menu ` +
        `("Switch back…") to return to your admin account.`,
    );
    if (!ok) return;
    setPendingImpersonationId(target.id);
    startImpersonation(async () => {
      const result = await impersonateUserAction(target.id);
      // On success the action redirects, so this only runs on failure.
      if (result?.error) {
        window.alert(`Impersonation failed: ${result.error}`);
        setPendingImpersonationId(null);
      }
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = q
      ? rows.filter((r) => {
          return (
            r.email.toLowerCase().includes(q) ||
            (r.name ?? "").toLowerCase().includes(q) ||
            (r.companyName ?? "").toLowerCase().includes(q)
          );
        })
      : rows.slice();

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "email":
          cmp = a.email.localeCompare(b.email);
          break;
        case "createdAt": {
          const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          cmp = at - bt;
          break;
        }
        case "tier": {
          // Group by paid-vs-free instead of alphabetical tier name. BYOK
          // users count as paid (they're effectively Enterprise). Within
          // each group keep a stable tier-name order so plans cluster.
          const aFree = a.tierCode === "free" && !a.hasUserApiKey ? 1 : 0;
          const bFree = b.tierCode === "free" && !b.hasUserApiKey ? 1 : 0;
          if (aFree !== bFree) {
            cmp = aFree - bFree;
          } else {
            cmp = a.tierName.localeCompare(b.tierName);
          }
          break;
        }
        case "currentMonthUsage":
          cmp = a.currentMonthUsage - b.currentMonthUsage;
          break;
        case "totalInvoices":
          cmp = a.totalInvoices - b.totalInvoices;
          break;
        case "vendorCount":
          cmp = a.vendorCount - b.vendorCount;
          break;
        case "totalLlmCostUsd":
          cmp = a.totalLlmCostUsd - b.totalLlmCostUsd;
          break;
        case "lastActivityAt": {
          const at = a.lastActivityAt
            ? new Date(a.lastActivityAt).getTime()
            : 0;
          const bt = b.lastActivityAt
            ? new Date(b.lastActivityAt).getTime()
            : 0;
          cmp = at - bt;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [rows, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "email" || key === "tier" || key === "createdAt"
          ? "asc"
          : "desc",
      );
    }
  }

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search by email, name, or company…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:max-w-sm"
        />
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {rows.length} user{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortButton onClick={() => toggleSort("email")}>
                  User {sortArrow("email")}
                </SortButton>
              </TableHead>
              <TableHead>
                <SortButton onClick={() => toggleSort("tier")}>
                  Plan {sortArrow("tier")}
                </SortButton>
              </TableHead>
              <TableHead className="text-end">
                <SortButton onClick={() => toggleSort("currentMonthUsage")}>
                  This month {sortArrow("currentMonthUsage")}
                </SortButton>
              </TableHead>
              <TableHead className="text-end">
                <SortButton onClick={() => toggleSort("totalInvoices")}>
                  Total invoices {sortArrow("totalInvoices")}
                </SortButton>
              </TableHead>
              <TableHead className="text-end">
                <SortButton onClick={() => toggleSort("vendorCount")}>
                  Vendors {sortArrow("vendorCount")}
                </SortButton>
              </TableHead>
              <TableHead className="text-end">
                <SortButton onClick={() => toggleSort("totalLlmCostUsd")}>
                  LLM cost {sortArrow("totalLlmCostUsd")}
                </SortButton>
              </TableHead>
              <TableHead>
                <SortButton onClick={() => toggleSort("lastActivityAt")}>
                  Last active {sortArrow("lastActivityAt")}
                </SortButton>
              </TableHead>
              <TableHead>
                <SortButton onClick={() => toggleSort("createdAt")}>
                  Joined {sortArrow("createdAt")}
                </SortButton>
              </TableHead>
              <TableHead className="w-[1%] whitespace-nowrap text-end">
                <span className="sr-only">Impersonate</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-sm text-muted-foreground"
                >
                  No users match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => {
                const usageRatio =
                  u.maxInvoicesPerMonth > 0
                    ? u.currentMonthUsage / u.maxInvoicesPerMonth
                    : 0;
                const overQuota = usageRatio >= 1;
                const nearQuota = !overQuota && usageRatio >= 0.8;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-[260px]">
                      <div className="flex flex-col">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="truncate">
                            {u.name ?? u.email}
                          </span>
                          {u.isAdmin && (
                            <Badge variant="secondary" className="shrink-0">
                              admin
                            </Badge>
                          )}
                        </span>
                        {u.name && (
                          <span className="truncate text-xs text-muted-foreground">
                            {u.email}
                          </span>
                        )}
                        {u.companyName && (
                          <span className="truncate text-xs text-muted-foreground">
                            {u.companyName}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge
                          variant={
                            u.tierCode === "free" ? "outline" : "default"
                          }
                        >
                          {u.tierName}
                        </Badge>
                        {u.hasUserApiKey && (
                          <Badge
                            variant="secondary"
                            title={
                              u.apiKeyHint
                                ? `User-provided Anthropic key (${u.apiKeyHint})`
                                : "User-provided Anthropic key"
                            }
                          >
                            BYOK
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      <span
                        className={
                          overQuota
                            ? "font-semibold text-destructive"
                            : nearQuota
                              ? "font-semibold text-amber-600"
                              : ""
                        }
                      >
                        {u.currentMonthUsage}
                      </span>
                      <span className="text-muted-foreground">
                        {" / "}
                        {u.maxInvoicesPerMonth}
                      </span>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      <div className="flex flex-col items-end">
                        <span className="font-medium">{u.totalInvoices}</span>
                        <span className="text-xs text-muted-foreground">
                          {u.approvedInvoices} ok · {u.pendingInvoices} pend ·{" "}
                          {u.rejectedInvoices} rej
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {u.vendorCount}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatCost(u.totalLlmCostUsd)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{formatRelative(u.lastActivityAt)}</span>
                        {u.lastActivityAt && (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(u.lastActivityAt)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-end">
                      {u.id !== currentAdminId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={pendingImpersonationId !== null}
                          onClick={() => handleImpersonate(u)}
                          title={`Sign in as ${u.email}`}
                        >
                          <LogIn className="h-3 w-3" />
                          {pendingImpersonationId === u.id
                            ? "Signing in…"
                            : "Impersonate"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SortButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="-mx-2 h-7 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </Button>
  );
}

