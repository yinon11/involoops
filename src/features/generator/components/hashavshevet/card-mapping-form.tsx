"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  saveMoveinExportSettings,
  type MoveinSettingsDto,
} from "@/features/generator/actions/movein-export-actions";
import { useI18n } from "@/lib/i18n/client";
import { Loader2, Save } from "lucide-react";

type FieldKey = keyof Omit<MoveinSettingsDto, "exportEmail" | "method">;

const CARD_FIELD_GROUPS: { titleKey: string; fields: FieldKey[] }[] = [
  {
    titleKey: "cashBoxes",
    fields: [
      "generalCash",
      "creditCardCash",
      "cash",
      "checkCash",
      "transferUsd",
      "transferEur",
      "transferGbp",
      "transferJpy",
      "paypal",
      "bit",
      "pepper",
      "credit",
    ],
  },
  {
    titleKey: "accounts",
    fields: [
      "purchase",
      "inputVat",
      "withholdingTax",
      "outputVat",
      "income",
      "exemptIncome",
      "cashCustomer",
    ],
  },
];

export function CardMappingForm({ initial }: { initial: MoveinSettingsDto }) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.hashavshevet;
  const labels = t.fields as Record<string, string>;

  const [form, setForm] = useState<MoveinSettingsDto>(initial);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  function update<K extends keyof MoveinSettingsDto>(
    key: K,
    value: MoveinSettingsDto[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveMoveinExportSettings(form);
      if ("error" in res) {
        setMessage({ kind: "error", text: res.error });
        return;
      }
      setMessage({ kind: "ok", text: t.settingsSaved });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.settingsTitle}</CardTitle>
        <p className="text-sm text-zinc-600">{t.settingsExplain}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{t.exportEmail}</Label>
            <Input
              type="email"
              dir="ltr"
              value={form.exportEmail}
              onChange={(e) => update("exportEmail", e.target.value)}
              placeholder="accountant@example.com"
            />
            <p className="text-xs text-zinc-500">{t.exportEmailHint}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t.method}</Label>
            <Select
              value={form.method}
              onValueChange={(v) =>
                update("method", v as MoveinSettingsDto["method"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="detailed">{t.methodDetailed}</SelectItem>
                {/* Not selectable: build.ts implements "detailed" only and
                    throws for the others. Re-enable when it is implemented. */}
                <SelectItem value="short" disabled>
                  {t.methodShort}
                </SelectItem>
                <SelectItem value="flexible" disabled>
                  {t.methodFlexible} ({t.comingSoon})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {CARD_FIELD_GROUPS.map((group) => (
          <div key={group.titleKey} className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-800">
              {t.groups[group.titleKey as keyof typeof t.groups]}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.fields.map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{labels[key] ?? key}</Label>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    value={form[key]}
                    onChange={(e) => update(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={isPending} className="gap-2">
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t.save}
          </Button>
          {message && (
            <p
              className={
                message.kind === "error"
                  ? "text-sm text-red-700"
                  : "text-sm text-green-700"
              }
              role="status"
            >
              {message.text}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
