"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { User, Coins, Building2, Repeat } from "lucide-react";
import {
  updateAutoActAsManagedAccountsAction,
  updateCompanyNameAction,
  updateDisplayCurrencyAction,
} from "@/actions/user-preferences-actions";
import { useI18n } from "@/lib/i18n/client";

const DISPLAY_CURRENCY_CODES = ["ILS", "USD", "EUR", "GBP"] as const;
type DisplayCurrencyCode = (typeof DISPLAY_CURRENCY_CODES)[number];

interface AccountCardProps {
  user: {
    name: string;
    email: string;
    companyName: string | null;
    displayCurrency: string | null;
    resolvedDisplayCurrency: string;
    autoActAsManagedAccounts: boolean;
    /** Manages at least one other account via account_links — controls whether the auto-switch toggle is shown. */
    hasManagedAccounts: boolean;
  };
}

export function AccountCard({ user }: AccountCardProps) {
  const { dict } = useI18n();
  const t = dict.settings.account;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSavingCompany, startSaveCompany] = useTransition();
  const [isSavingAutoActAs, startSaveAutoActAs] = useTransition();
  const [autoActAs, setAutoActAs] = useState<boolean>(user.autoActAsManagedAccounts);
  const [companyName, setCompanyName] = useState<string>(user.companyName ?? "");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Track the last persisted value so the Save button can disable when there
  // are no unsaved edits. We avoid an external "dirty" library — comparing
  // against the trimmed stored value is enough for a single text input.
  const persistedCompany = user.companyName ?? "";
  const isCompanyDirty = companyName.trim() !== persistedCompany.trim();

  async function handleDisplayCurrencyChange(code: string) {
    setFeedback(null);
    try {
      const result = await updateDisplayCurrencyAction(code);
      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        return;
      }
      setFeedback({
        type: "success",
        message: t.currencyUpdated.replace("{code}", code),
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.updateFailed,
      });
    }
  }

  function handleAutoActAsChange(next: boolean) {
    setFeedback(null);
    setAutoActAs(next);
    startSaveAutoActAs(async () => {
      try {
        const result = await updateAutoActAsManagedAccountsAction(next);
        if (!result.ok) {
          setAutoActAs(!next);
          setFeedback({ type: "error", message: result.error });
          return;
        }
        setFeedback({
          type: "success",
          message: next ? t.autoActAsEnabled : t.autoActAsDisabled,
        });
        router.refresh();
      } catch (err) {
        setAutoActAs(!next);
        setFeedback({
          type: "error",
          message: err instanceof Error ? err.message : t.updateFailed,
        });
      }
    });
  }

  function handleCompanyNameSave() {
    setFeedback(null);
    startSaveCompany(async () => {
      try {
        const next = companyName.trim();
        const result = await updateCompanyNameAction(next.length === 0 ? null : next);
        if (!result.ok) {
          setFeedback({ type: "error", message: result.error });
          return;
        }
        setFeedback({
          type: "success",
          message:
            next.length === 0
              ? t.companyNameCleared
              : t.companyNameUpdated,
        });
        router.refresh();
      } catch (err) {
        setFeedback({
          type: "error",
          message: err instanceof Error ? err.message : t.updateFailed,
        });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          {t.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {feedback && (
          <div
            className={`rounded-md p-3 text-sm ${
              feedback.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {feedback.message}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t.name}</Label>
            <Input value={user.name} readOnly className="bg-muted" />
          </div>
          <div className="space-y-1.5">
            <Label>{t.email}</Label>
            <Input value={user.email} readOnly className="bg-muted" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t.managedByProvider}</p>

        <Separator />

        <div>
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            <h3 className="font-semibold">{t.companyNameTitle}</h3>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {t.companyNameDescription}
          </p>
          <div className="space-y-1.5 sm:max-w-md">
            <Label htmlFor="account-company-name">{t.companyNameLabel}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="account-company-name"
                value={companyName}
                placeholder={t.companyNamePlaceholder}
                maxLength={255}
                onChange={(event) => setCompanyName(event.target.value)}
                disabled={isSavingCompany}
              />
              <Button
                type="button"
                onClick={handleCompanyNameSave}
                disabled={!isCompanyDirty || isSavingCompany}
              >
                {isSavingCompany ? t.saving : t.save}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t.companyNameHint}
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <div className="mb-3 flex items-center gap-2">
            <Coins className="h-5 w-5" />
            <h3 className="font-semibold">{t.dashboardCurrency}</h3>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {t.dashboardCurrencyDescription}
          </p>
          <div className="sm:max-w-xs">
            <Select
              value={user.displayCurrency ?? user.resolvedDisplayCurrency}
              onValueChange={handleDisplayCurrencyChange}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISPLAY_CURRENCY_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t.currencyOptions[code as DisplayCurrencyCode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {user.displayCurrency == null && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t.usingSystemDefault.replace(
                  "{currency}",
                  user.resolvedDisplayCurrency
                )}
              </p>
            )}
          </div>
        </div>

        {user.hasManagedAccounts && (
          <>
            <Separator />
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Repeat className="h-5 w-5" />
                <h3 className="font-semibold">{t.autoActAsTitle}</h3>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                {t.autoActAsDescription}
              </p>
              <div className="flex items-center gap-3">
                <Switch
                  id="auto-act-as-toggle"
                  checked={autoActAs}
                  onCheckedChange={handleAutoActAsChange}
                  disabled={isSavingAutoActAs}
                />
                <Label
                  htmlFor="auto-act-as-toggle"
                  className="text-sm font-normal"
                >
                  {autoActAs ? t.autoActAsOn : t.autoActAsOff}
                </Label>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
