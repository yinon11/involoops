"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  setSandboxMockSetting,
  type SandboxMockSettingView,
} from "@/actions/shaam-actions";

type Mode = "" | "approve" | "reject" | "hold" | "outage";

const MODES: Array<{ value: Mode; label: string; help: string }> = [
  { value: "", label: "Normal", help: "The Tax Authority's test service when connected, otherwise a local approval." },
  { value: "approve", label: "Approve", help: "Local approval with a TEST- number, even when connected." },
  { value: "reject", label: "Refuse", help: "Refused on the merits (code 462 by default): the seller gets the four alternatives." },
  { value: "hold", label: "Hold", help: "Held (code 460), with a hearing deadline in 14 days." },
  { value: "outage", label: "Outage", help: "No answer: issued as awaiting its number, retried by the cron." },
];

function split(value: string): { mode: Mode; code: string } {
  const [head, code] = value.split(":");
  const mode = (MODES.some((m) => m.value === head) ? head : "") as Mode;
  return { mode, code: mode === "reject" && code ? code : "" };
}

/**
 * Sandbox only — the page renders this card only on the sandbox stack, and
 * the action refuses anywhere else. Takes effect on the next request.
 */
export function SandboxMockCard({ setting }: { setting: SandboxMockSettingView }) {
  const router = useRouter();
  const initial = split(setting.value);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [code, setCode] = useState(initial.code);
  const [isPending, startTransition] = useTransition();

  const next = mode === "reject" && code.trim() ? `reject:${code.trim()}` : mode;
  const dirty = next !== setting.value;

  function save() {
    startTransition(async () => {
      const res = await setSandboxMockSetting(next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next ? `Tax Authority answer forced: ${next}` : "Tax Authority answer back to normal");
      router.refresh();
    });
  }

  const active = setting.value !== "";

  return (
    <Card className={active ? "border-amber-400" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" />
          Sandbox: Tax Authority answer
          {active && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              forced: {setting.value}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          For testing refusals, holds and outages. Applies to every allocation request on this
          sandbox server, for every business, from the next request on — no restart. Nothing is sent to the Tax
          Authority while an answer is forced, and the seller&apos;s choice after a forced refusal
          is not reported to it. A refusal blocks only an invoice that needs an allocation number.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m.value || "normal"}
              className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
                mode === m.value ? "border-slate-900 bg-slate-50" : "border-slate-200"
              }`}
            >
              <input
                type="radio"
                name="sandbox-mock-mode"
                className="mt-1"
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
              />
              <span>
                <span className="font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.help}</span>
              </span>
            </label>
          ))}
        </div>

        {mode === "reject" && (
          <div className="flex items-center gap-2">
            <label htmlFor="sandbox-mock-code" className="text-xs text-muted-foreground">
              Error code (optional, default 462 — e.g. 30 for an invalid customer VAT id)
            </label>
            <Input
              id="sandbox-mock-code"
              dir="ltr"
              className="w-28"
              value={code}
              placeholder="462"
              onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z_]/g, "").slice(0, 32))}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {setting.updatedAt
              ? `Last changed ${setting.updatedAt.replace("T", " ").slice(0, 16)} UTC`
              : "Never changed"}
          </p>
          <Button size="sm" onClick={save} disabled={!dirty || isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
