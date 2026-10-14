"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Mail,
  Search,
  Clock,
  CheckCircle,
  Circle,
  ArrowRight,
  User,
  Loader2,
  Eye,
  Send,
  ChevronRight,
  Zap,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import type {
  AdminFunnelGroup,
  AdminFunnel,
  AdminUserSearch,
  AdminUserFunnelState,
  AdminUserEmail,
  EmailPreviewData,
} from "@/actions/email-funnel-admin-actions";
import {
  searchFunnelUsers,
  getUserActiveFunnels,
  getUserEmailHistory,
  setFunnelActive,
  previewEmailTemplate,
} from "@/actions/email-funnel-admin-actions";
import { ExportXlsxButton } from "@/components/shared/export-xlsx-button";

interface Props {
  groups: AdminFunnelGroup[];
  funnels: AdminFunnel[];
  /** When false, automation is off (EMAIL_FUNNELS_ENABLED). Per-funnel DB toggles still apply after re-enable. */
  funnelsGloballyEnabled: boolean;
  /** Pre-selected user when the page is opened with `?userId=…` (e.g. deep-linked from planned emails). */
  initialSelectedUser?: AdminUserSearch | null;
  initialUserFunnels?: AdminUserFunnelState[];
  initialUserEmails?: AdminUserEmail[];
}

function formatDelay(hours: number): string {
  if (hours === 0) return "Immediately";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

function formatDate(d: Date | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(d: Date | null): string {
  if (!d) return "";
  const now = new Date();
  const target = new Date(d);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "Due now";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h`;
  }
  return hours > 0 ? `in ${hours}h ${mins}m` : `in ${mins}m`;
}

export function EmailFunnelsClient({
  groups,
  funnels,
  funnelsGloballyEnabled,
  initialSelectedUser = null,
  initialUserFunnels = [],
  initialUserEmails = [],
}: Props) {
  const router = useRouter();
  const [selectedGroup, setSelectedGroup] = useState<string>(
    groups[0]?.key ?? "",
  );
  /** Selection tracked by id so `isActive` stays in sync when props refresh after toggling. */
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);
  /** Optimistic active state until RSC props catch up (keyed by funnel id). */
  const [activeOverride, setActiveOverride] = useState<{
    funnelId: string;
    value: boolean;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AdminUserSearch[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserSearch | null>(
    initialSelectedUser,
  );
  const [userFunnels, setUserFunnels] =
    useState<AdminUserFunnelState[]>(initialUserFunnels);
  const [userEmails, setUserEmails] =
    useState<AdminUserEmail[]>(initialUserEmails);
  const [isPending, startTransition] = useTransition();
  const [previewData, setPreviewData] = useState<EmailPreviewData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<"html" | "text">("html");

  const groupFunnels = funnels.filter((f) => f.funnelGroup === selectedGroup);
  const currentGroup = groups.find((g) => g.key === selectedGroup);

  const selectedFunnel =
    groupFunnels.find((f) => f.id === selectedFunnelId) ??
    groupFunnels[0] ??
    null;

  // `activeOverride` is an optimistic toggle: set the moment the switch is
  // flipped, so the UI does not wait for the round trip. It stops applying
  // once the server catches up (router.refresh brings a new `isActive`).
  //
  // That used to be two effects whose only job was to null it out — one on
  // funnel change, one when the server agreed. Deriving staleness instead
  // means there is nothing to clear, and setState in an effect is exactly
  // the cascading-render pattern react-hooks objects to.
  const overrideApplies =
    activeOverride !== null &&
    selectedFunnel !== null &&
    activeOverride.funnelId === selectedFunnel.id &&
    selectedFunnel.isActive !== activeOverride.value;

  const shownIsActive = overrideApplies
    ? activeOverride.value
    : (selectedFunnel?.isActive ?? false);

  // Auto-select first funnel when group changes
  const handleGroupChange = useCallback(
    (key: string) => {
      setSelectedGroup(key);
      const gf = funnels.filter((f) => f.funnelGroup === key);
      setSelectedFunnelId(gf[0]?.id ?? null);
      // Changing selection abandons any pending optimistic toggle.
      setActiveOverride(null);
    },
    [funnels],
  );

  async function handleSearch() {
    if (searchQuery.length < 2) return;
    startTransition(async () => {
      const results = await searchFunnelUsers(searchQuery);
      setSearchResults(results);
    });
  }

  async function handleSelectUser(user: AdminUserSearch) {
    setSelectedUser(user);
    setSearchResults([]);
    startTransition(async () => {
      const [funnelStates, emails] = await Promise.all([
        getUserActiveFunnels(user.id),
        getUserEmailHistory(user.id),
      ]);
      setUserFunnels(funnelStates);
      setUserEmails(emails);
    });
  }

  function handleFunnelActiveChange(nextActive: boolean) {
    const funnel = selectedFunnel;
    if (!funnel) return;
    const funnelId = funnel.id;
    setActiveOverride({ funnelId, value: nextActive });
    startTransition(async () => {
      const result = await setFunnelActive(funnelId, nextActive);
      if (!result.ok) {
        setActiveOverride(null);
        const msg =
          result.error === "not_admin"
            ? "Admin access required to change funnels."
            : result.error === "not_found"
              ? "Funnel was not found in the database."
              : "Could not update funnel.";
        toast.error(msg);
        return;
      }
      router.refresh();
    });
  }

  async function handlePreview(templateCode: string) {
    setPreviewLoading(true);
    setPreviewOpen(true);
    setPreviewTab("html");
    const data = await previewEmailTemplate(templateCode);
    setPreviewData(data);
    setPreviewLoading(false);
  }

  // Check if user is currently on a specific step
  function isUserOnStep(funnelCode: string, stepNum: number): boolean {
    const state = userFunnels.find(
      (f) => f.funnelCode === funnelCode && f.status === "active",
    );
    if (!state) return false;
    // currentStep=0 means entered but step 1 not sent → highlight step 1
    return state.currentStep === 0
      ? stepNum === 1
      : state.currentStep === stepNum;
  }

  // Check if step is the next scheduled one
  function isNextScheduled(funnelCode: string, stepNum: number): boolean {
    const state = userFunnels.find(
      (f) => f.funnelCode === funnelCode && f.status === "active",
    );
    if (!state) return false;
    const nextStep = state.currentStep + 1;
    if (stepNum !== nextStep) return false;
    // Check it hasn't been sent
    const sent = userEmails.find(
      (e) => e.funnelCode === funnelCode && e.funnelStep === stepNum,
    );
    return !sent;
  }

  // Check if email was already sent for this step
  function getStepEmail(
    funnelCode: string,
    stepNum: number,
  ): AdminUserEmail | undefined {
    return userEmails.find(
      (e) => e.funnelCode === funnelCode && e.funnelStep === stepNum,
    );
  }

  const statusBadge: Record<string, string> = {
    sent: "bg-blue-100 text-blue-800",
    delivered: "bg-green-100 text-green-800",
    bounced: "bg-red-100 text-red-800",
    complained: "bg-red-100 text-red-800",
    failed: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
  };

  return (
    <div className="space-y-6">
      {!funnelsGloballyEnabled && (
        <div
          className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium">Email funnel automation is off</p>
            <p className="mt-1 text-amber-900/90 dark:text-amber-100/85">
              <code className="rounded bg-amber-100/80 px-1 font-mono text-xs dark:bg-amber-900/60">EMAIL_FUNNELS_ENABLED</code> is disabled in{" "}
              <code className="rounded bg-amber-100/80 px-1 font-mono text-xs dark:bg-amber-900/60">.env</code>. Set it to{" "}
              <code className="rounded bg-amber-100/80 px-1 font-mono text-xs dark:bg-amber-900/60">true</code> or remove the variable, then restart the app
              to resume automatic enrollments and cron sends. Per-funnel switches below still update the database.
            </p>
          </div>
        </div>
      )}

      {/* ── Top Bar: Stats + User Search ── */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">{funnels.length}</strong> Funnels
          </span>
          <span>
            <strong className="text-foreground">{groups.length}</strong> Groups
          </span>
          <span>
            <strong className="text-foreground">
              {funnels.reduce((a, f) => a + f.steps.length, 0)}
            </strong>{" "}
            Steps
          </span>
          <span>
            <strong className="text-foreground">
              {funnels.filter((f) => f.isActive).length}
            </strong>{" "}
            Active
          </span>
        </div>
        <div className="ms-auto flex gap-2">
          <Input
            placeholder="Search by email or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-64"
          />
          <Button variant="outline" size="icon" onClick={handleSearch} disabled={isPending}>
            {isPending && !previewLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Search results dropdown */}
      {searchResults.length > 0 && !selectedUser && (
        <Card>
          <CardContent className="p-2">
            {searchResults.map((user) => (
              <button
                key={user.id}
                className="flex w-full items-center gap-3 rounded-md p-2 text-start text-sm hover:bg-muted"
                onClick={() => handleSelectUser(user)}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: currentGroup?.color ?? "#8B5CF6" }}
                >
                  {(user.name || user.email).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium">{user.email}</p>
                  {user.name && (
                    <p className="text-xs text-muted-foreground">{user.name}</p>
                  )}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Selected user banner */}
      {selectedUser && (
        <div
          className="flex items-center gap-3 rounded-lg border p-3"
          style={{
            borderColor: `${currentGroup?.color ?? "#8B5CF6"}40`,
            background: `${currentGroup?.color ?? "#8B5CF6"}08`,
          }}
        >
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: currentGroup?.color ?? "#8B5CF6" }}
          >
            {(selectedUser.name || selectedUser.email).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{selectedUser.email}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {selectedUser.name && <span>{selectedUser.name}</span>}
              <span>-</span>
              <span>
                {userFunnels.filter((f) => f.status === "active").length} active
                funnels
              </span>
              <span>-</span>
              <span>{userEmails.length} emails sent</span>
            </div>
          </div>
          {/* Active funnel badges */}
          <div className="flex gap-1">
            {userFunnels
              .filter((f) => f.status === "active")
              .map((f) => (
                <Badge
                  key={f.stateId}
                  variant="outline"
                  className="text-xs"
                  style={{ borderColor: currentGroup?.color }}
                >
                  {f.funnelCode} (step {f.currentStep})
                </Badge>
              ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedUser(null);
              setUserFunnels([]);
              setUserEmails([]);
              setSearchQuery("");
              // Drop the `?userId=` query param so a refresh doesn't
              // reload the deep-linked user.
              if (
                typeof window !== "undefined" &&
                window.location.search.includes("userId")
              ) {
                router.replace("/admin/email-funnels");
              }
            }}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Group Tabs ── */}
      <div className="flex gap-2 border-b pb-3">
        {groups.map((g) => {
          const isActive = selectedGroup === g.key;
          return (
            <button
              key={g.key}
              onClick={() => handleGroupChange(g.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                isActive
                  ? "text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              style={
                isActive
                  ? { background: g.color }
                  : {}
              }
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: g.color }}
              />
              {g.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  isActive ? "bg-white/20" : "bg-muted"
                }`}
              >
                {g.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Main Content: Funnel List + Detail ── */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Funnel list sidebar */}
        <div className="space-y-1 lg:col-span-3">
          {groupFunnels.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No funnels in this group yet.
            </p>
          ) : (
            groupFunnels.map((funnel) => {
              const isSelected = selectedFunnel?.id === funnel.id;
              const userInFunnel = userFunnels.some(
                (f) => f.funnelCode === funnel.code,
              );

              return (
                <button
                  key={funnel.id}
                  onClick={() => {
                    setSelectedFunnelId(funnel.id);
                    setActiveOverride(null);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-start transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-transparent hover:bg-muted"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        {funnel.code}
                      </span>
                      {!funnel.isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                      )}
                      {funnel.isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      )}
                      {userInFunnel && (
                        <User className="h-3 w-3 text-amber-500" />
                      )}
                    </div>
                    <p className="truncate text-sm font-medium">{funnel.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {funnel.steps.length} steps
                      {funnel.isTransactional && " - transactional"}
                    </p>
                  </div>
                  <ChevronRight
                    className={`h-4 w-4 text-muted-foreground ${
                      isSelected ? "text-primary" : ""
                    }`}
                  />
                </button>
              );
            })
          )}
        </div>

        {/* Funnel detail */}
        <div className="lg:col-span-9">
          {selectedFunnel ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{selectedFunnel.name}</CardTitle>
                      <Badge variant="outline" className="font-mono text-xs">
                        {selectedFunnel.code}
                      </Badge>
                      {selectedFunnel.isTransactional && (
                        <Badge className="bg-indigo-100 text-indigo-800 text-xs">
                          <Zap className="me-1 h-3 w-3" />
                          Transactional
                        </Badge>
                      )}
                    </div>
                    {selectedFunnel.description && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedFunnel.description}
                      </p>
                    )}
                    <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                      {selectedFunnel.entryEvent && (
                        <span className="flex items-center gap-1">
                          <ArrowRight className="h-3 w-3" />
                          Entry: <code className="font-mono">{selectedFunnel.entryEvent}</code>
                        </span>
                      )}
                      {selectedFunnel.mutexGroup && (
                        <span>Mutex: <code className="font-mono">{selectedFunnel.mutexGroup}</code></span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {shownIsActive ? "Active" : "Inactive"}
                    </span>
                    <Switch
                      checked={shownIsActive}
                      disabled={isPending}
                      onCheckedChange={handleFunnelActiveChange}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Steps timeline */}
                <div className="space-y-1">
                  {selectedFunnel.steps.map((step, idx) => {
                    const sentEmail = selectedUser
                      ? getStepEmail(selectedFunnel.code, step.stepNumber)
                      : undefined;
                    const isCurrent =
                      selectedUser &&
                      isUserOnStep(selectedFunnel.code, step.stepNumber);
                    const isNext =
                      selectedUser &&
                      isNextScheduled(selectedFunnel.code, step.stepNumber);
                    const isSent = !!sentEmail;

                    let stepBg = "bg-muted/50";
                    let stepBorder = "border-transparent";
                    let numberBg = "bg-muted text-muted-foreground";

                    if (isCurrent) {
                      stepBg = "bg-amber-50";
                      stepBorder = "border-amber-300";
                      numberBg = "bg-amber-500 text-white";
                    } else if (isNext) {
                      stepBg = "bg-green-50";
                      stepBorder = "border-green-300";
                      numberBg = "bg-green-500 text-white";
                    } else if (isSent) {
                      stepBg = "bg-gray-50";
                      stepBorder = "border-gray-200";
                      numberBg = "bg-gray-400 text-white";
                    }

                    return (
                      <div
                        key={step.id}
                        className={`flex items-start gap-4 rounded-lg border p-3 transition-colors ${stepBg} ${stepBorder}`}
                      >
                        {/* Step number */}
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${numberBg}`}
                          >
                            {step.stepNumber}
                          </div>
                          {idx < selectedFunnel.steps.length - 1 && (
                            <div className="h-4 w-0.5 bg-border" />
                          )}
                        </div>

                        {/* Step content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold">{step.templateName}</p>
                            {isCurrent && (
                              <Badge className="bg-amber-100 text-amber-800 text-[10px]">
                                Current
                              </Badge>
                            )}
                            {isNext && (
                              <Badge className="bg-green-100 text-green-800 text-[10px]">
                                Next Scheduled
                              </Badge>
                            )}
                            {isSent && !isCurrent && (
                              <Badge variant="secondary" className="text-[10px]">
                                <CheckCircle className="me-1 h-3 w-3" />
                                Sent {formatDate(sentEmail?.sentAt ?? null)}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">
                            {step.subject}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDelay(step.delayHours)}
                              {step.delayFrom === "funnel_entry" && (
                                <span className="text-amber-600">(from entry)</span>
                              )}
                            </span>
                            {sentEmail && (
                              <>
                                {sentEmail.openCount > 0 && (
                                  <span className="text-blue-600">
                                    {sentEmail.openCount} opens
                                  </span>
                                )}
                                {sentEmail.clickCount > 0 && (
                                  <span className="text-green-600">
                                    {sentEmail.clickCount} clicks
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Preview button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePreview(step.templateCode)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>

                {/* Exit conditions */}
                {selectedFunnel.exits.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Exit Conditions
                      </p>
                      {selectedFunnel.exits.map((exit) => (
                        <div
                          key={exit.id}
                          className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs"
                        >
                          <XCircle className="h-3 w-3 text-red-400" />
                          <code className="font-mono">{exit.exitCondition}</code>
                          {exit.targetFunnelCode && (
                            <>
                              <ArrowRight className="h-3 w-3" />
                              <Badge variant="outline" className="text-xs">
                                Jump → {exit.targetFunnelCode}
                              </Badge>
                            </>
                          )}
                          {exit.description && (
                            <span className="text-muted-foreground">
                              - {exit.description}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex h-64 items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Mail className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  <p className="text-sm">Select a funnel to view details</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── User Email History ── */}
      {selectedUser && userEmails.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Send className="h-4 w-4" />
                Email History ({userEmails.length})
              </CardTitle>
              <ExportXlsxButton
                rows={() =>
                  userEmails.map((e) => ({
                    Funnel: e.funnelCode ?? "",
                    Step: e.funnelStep ?? "",
                    Template: e.templateName ?? "",
                    Subject: e.subject ?? "",
                    Status: e.status ?? "",
                    "Sent At": e.sentAt
                      ? new Date(e.sentAt).toISOString()
                      : "",
                    "Delivered At": e.deliveredAt
                      ? new Date(e.deliveredAt).toISOString()
                      : "",
                    Opens: e.openCount ?? 0,
                    Clicks: e.clickCount ?? 0,
                  }))
                }
                filename={`email-history-${selectedUser.email}`}
                sheetName="Email History"
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Funnel</TableHead>
                  <TableHead className="text-xs">Step</TableHead>
                  <TableHead className="text-xs">Template</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Sent</TableHead>
                  <TableHead className="text-xs">Delivered</TableHead>
                  <TableHead className="text-xs">Opens</TableHead>
                  <TableHead className="text-xs">Clicks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userEmails.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell className="font-mono text-xs">
                      {email.funnelCode ?? "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {email.funnelStep ?? "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>
                        <p className="font-medium">{email.templateName}</p>
                        <p className="text-muted-foreground truncate max-w-[200px]">
                          {email.subject}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-xs ${statusBadge[email.status] ?? ""}`}
                      >
                        {email.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(email.sentAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(email.deliveredAt)}
                    </TableCell>
                    <TableCell className="text-xs">{email.openCount}</TableCell>
                    <TableCell className="text-xs">{email.clickCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                  <TableCell colSpan={6} className="text-xs">
                    Total
                  </TableCell>
                  <TableCell className="text-xs">
                    {userEmails.reduce((s, e) => s + (e.openCount ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {userEmails.reduce((s, e) => s + (e.clickCount ?? 0), 0)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── User Funnel States (all, not just active) ── */}
      {selectedUser && userFunnels.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Funnel Journey ({userFunnels.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {userFunnels.map((f) => (
                <div
                  key={f.stateId}
                  className={`rounded-lg border p-3 ${
                    f.status === "active"
                      ? "border-green-200 bg-green-50"
                      : f.status === "completed"
                        ? "border-blue-200 bg-blue-50"
                        : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {f.status === "active" ? (
                      <Circle className="h-3 w-3 fill-green-500 text-green-500" />
                    ) : f.status === "completed" ? (
                      <CheckCircle className="h-3 w-3 text-blue-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-gray-400" />
                    )}
                    <span className="font-mono text-xs text-muted-foreground">
                      {f.funnelCode}
                    </span>
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {f.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium">{f.funnelName}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Step {f.currentStep}</span>
                    {f.nextEmailAt && (
                      <span className="text-green-600">
                        Next: {formatRelativeTime(f.nextEmailAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Entered: {formatDate(f.enteredAt)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Email Preview Modal ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Preview
            </DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : previewData ? (
            <div className="flex flex-col gap-3 overflow-hidden flex-1">
              {/* Subject */}
              <div className="rounded-md bg-muted px-3 py-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Subject:{" "}
                </span>
                <span className="text-sm">{previewData.subject}</span>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b">
                <button
                  onClick={() => setPreviewTab("html")}
                  className={`px-3 py-1.5 text-sm font-medium ${
                    previewTab === "html"
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  HTML
                </button>
                <button
                  onClick={() => setPreviewTab("text")}
                  className={`px-3 py-1.5 text-sm font-medium ${
                    previewTab === "text"
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  Plain Text
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-auto rounded-md border bg-white">
                {previewTab === "html" ? (
                  <iframe
                    srcDoc={previewData.html}
                    className="h-[400px] w-full"
                    title="Email Preview"
                    sandbox=""
                  />
                ) : (
                  <pre className="whitespace-pre-wrap p-4 text-sm text-gray-700">
                    {previewData.text || "No plain text version available."}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Template not found.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
