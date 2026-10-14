"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createApiKey,
  revokeApiKey,
  type ApiKeyListItem,
} from "@/features/generator/actions/api-key-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, KeyRound, Ban } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";

interface Props {
  initialKeys: ApiKeyListItem[];
  availableScopes: string[];
}

type ScopeGroupKey =
  | "me"
  | "outbound"
  | "customers"
  | "templates"
  | "invoices"
  | "vendors"
  | "uploads"
  | "compliance"
  | "webhooks";

const SCOPE_GROUPS: { key: ScopeGroupKey; scopes: string[] }[] = [
  { key: "me", scopes: ["me:read"] },
  {
    key: "outbound",
    scopes: ["outbound:read", "outbound:write", "outbound:issue"],
  },
  { key: "customers", scopes: ["customers:read", "customers:write"] },
  { key: "templates", scopes: ["templates:read", "templates:write"] },
  { key: "invoices", scopes: ["invoices:read", "invoices:write"] },
  { key: "vendors", scopes: ["vendors:read", "vendors:write"] },
  { key: "uploads", scopes: ["uploads:write"] },
  {
    key: "compliance",
    scopes: ["audit:read", "archive:read", "shaam:read"],
  },
  { key: "webhooks", scopes: ["webhooks:write"] },
];

export function ApiKeysClient({ initialKeys, availableScopes }: Props) {
  const router = useRouter();
  const { dict, tag } = useI18n();
  const t = dict.apiKeys;
  const [keys, setKeys] = useState<ApiKeyListItem[]>(initialKeys);
  const [open, setOpen] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<{
    name: string;
    token: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    name: "",
    mode: "test" as "test" | "live",
    scopes: new Set<string>(["me:read"]),
  });

  function toggleScope(scope: string) {
    setForm((prev) => {
      const next = new Set(prev.scopes);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return { ...prev, scopes: next };
    });
  }

  // Build the (group, visibleScopes) view once — `availableScopes` is the
  // server-side allowlist, so a scope listed in SCOPE_GROUPS but not granted
  // to this user gets filtered out before "Select all" can pick it up.
  const visibleGroups = SCOPE_GROUPS.map((g) => ({
    key: g.key,
    scopes: g.scopes.filter((s) => availableScopes.includes(s)),
  })).filter((g) => g.scopes.length > 0);

  const allVisibleScopes = visibleGroups.flatMap((g) => g.scopes);
  const totalScopeCount = allVisibleScopes.length;
  const selectedScopeCount = allVisibleScopes.filter((s) =>
    form.scopes.has(s),
  ).length;
  const allSelected =
    totalScopeCount > 0 && selectedScopeCount === totalScopeCount;

  function setAllScopes(scopes: string[], checked: boolean) {
    setForm((prev) => {
      const next = new Set(prev.scopes);
      if (checked) {
        for (const s of scopes) next.add(s);
      } else {
        for (const s of scopes) next.delete(s);
      }
      return { ...prev, scopes: next };
    });
  }

  function toggleAllScopes() {
    setAllScopes(allVisibleScopes, !allSelected);
  }

  function toggleGroup(scopes: string[]) {
    const allOn = scopes.every((s) => form.scopes.has(s));
    setAllScopes(scopes, !allOn);
  }

  function handleCreate() {
    startTransition(async () => {
      try {
        const result = await createApiKey({
          name: form.name.trim(),
          mode: form.mode,
          scopes: Array.from(form.scopes),
        });
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        setKeys((prev) => [result.key, ...prev]);
        setNewlyCreated({ name: result.key.name, token: result.token });
        setForm({
          name: "",
          mode: "test",
          scopes: new Set(["me:read"]),
        });
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t.toast.createFailed);
      }
    });
  }

  function handleRevoke(id: string, label: string) {
    startTransition(async () => {
      try {
        await revokeApiKey(id);
        setKeys((prev) =>
          prev.map((k) =>
            k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k,
          ),
        );
        toast.success(format(t.toast.revoked, { name: label }));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t.toast.revokeFailed);
      }
    });
  }

  async function copyToken() {
    if (!newlyCreated) return;
    await navigator.clipboard.writeText(newlyCreated.token);
    toast.success(t.toast.copied);
  }

  const canSubmit = form.name.trim().length > 0 && form.scopes.size > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{t.list.title}</CardTitle>
            <CardDescription>{t.list.description}</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <KeyRound className="mr-2 h-4 w-4" />
                {t.list.newKey}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t.create.dialogTitle}</DialogTitle>
                <DialogDescription>
                  {t.create.dialogDescription}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-key-name">{t.create.nameLabel}</Label>
                  <Input
                    id="api-key-name"
                    placeholder={t.create.namePlaceholder}
                    value={form.name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, name: e.target.value }))
                    }
                    maxLength={120}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.create.modeLabel}</Label>
                  <Select
                    value={form.mode}
                    onValueChange={(v: "test" | "live") =>
                      setForm((p) => ({ ...p, mode: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="test">{t.create.modeTest}</SelectItem>
                      <SelectItem value="live">{t.create.modeLive}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>{t.create.scopesLabel}</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {format(t.create.scopesSelected, {
                          selected: selectedScopeCount,
                          total: totalScopeCount,
                        })}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={toggleAllScopes}
                        disabled={totalScopeCount === 0}
                      >
                        {allSelected
                          ? t.create.clearAll
                          : t.create.selectAll}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-md border p-3 space-y-3">
                    {visibleGroups.map((group) => {
                      const groupAllOn = group.scopes.every((s) =>
                        form.scopes.has(s),
                      );
                      const groupSomeOn =
                        !groupAllOn &&
                        group.scopes.some((s) => form.scopes.has(s));
                      return (
                        <div key={group.key}>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-muted-foreground">
                              {t.scopeGroups[group.key]}
                            </p>
                            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                              <Checkbox
                                checked={
                                  groupAllOn
                                    ? true
                                    : groupSomeOn
                                      ? "indeterminate"
                                      : false
                                }
                                onCheckedChange={() =>
                                  toggleGroup(group.scopes)
                                }
                                aria-label={`${t.create.groupSelectAll} — ${t.scopeGroups[group.key]}`}
                              />
                              {t.create.groupSelectAll}
                            </label>
                          </div>
                          <div className="space-y-1.5">
                            {group.scopes.map((s) => (
                              <label
                                key={s}
                                className="flex cursor-pointer items-center gap-2 text-sm"
                              >
                                <Checkbox
                                  checked={form.scopes.has(s)}
                                  onCheckedChange={() => toggleScope(s)}
                                />
                                <code className="text-xs" dir="ltr">
                                  {s}
                                </code>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t.create.cancel}</Button>
                </DialogClose>
                <Button
                  onClick={handleCreate}
                  disabled={!canSubmit || isPending}
                >
                  {isPending ? t.create.creating : t.create.create}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.list.empty}</p>
          ) : (
            <div className="space-y-3">
              {keys.map((k) => {
                const scopeLabel =
                  k.scopes.length === 1
                    ? format(t.list.scopeOne, { count: k.scopes.length })
                    : format(t.list.scopeOther, { count: k.scopes.length });
                const createdLabel = format(t.list.created, {
                  date: formatDate(k.createdAt, tag),
                });
                const lastUsedLabel = k.lastUsedAt
                  ? format(t.list.lastUsed, {
                      date: formatDate(k.lastUsedAt, tag),
                    })
                  : t.list.neverUsed;
                return (
                  <div
                    key={k.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{k.name}</p>
                        <Badge
                          variant={k.mode === "live" ? "default" : "secondary"}
                        >
                          {k.mode}
                        </Badge>
                        {k.revokedAt ? (
                          <Badge variant="destructive">
                            {t.list.revokedBadge}
                          </Badge>
                        ) : null}
                      </div>
                      <p
                        className="text-xs text-muted-foreground font-mono"
                        dir="ltr"
                      >
                        inv_{k.mode}_{k.publicId.slice(0, 8)}…
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {scopeLabel}
                        {t.list.separator}
                        {createdLabel}
                        {t.list.separator}
                        {lastUsedLabel}
                      </p>
                    </div>
                    {!k.revokedAt && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevoke(k.id, k.name)}
                        disabled={isPending}
                      >
                        <Ban className="mr-2 h-4 w-4" />
                        {t.list.revoke}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={newlyCreated !== null}
        onOpenChange={(o) => !o && setNewlyCreated(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.created.title}</DialogTitle>
            <DialogDescription>{t.created.description}</DialogDescription>
          </DialogHeader>
          <div
            className="rounded-md border bg-muted p-3 font-mono text-xs break-all"
            dir="ltr"
          >
            {newlyCreated?.token}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyToken}>
              <Copy className="mr-2 h-4 w-4" />
              {t.created.copy}
            </Button>
            <Button onClick={() => setNewlyCreated(null)}>
              {t.created.saved}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDate(iso: string, tag: string): string {
  const d = new Date(iso);
  return d.toLocaleString(tag, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
