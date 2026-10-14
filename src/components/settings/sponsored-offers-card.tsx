"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setSponsorTargetingOptOut } from "@/actions/sponsor-actions";
import { useT } from "@/lib/i18n/client";

/**
 * The user's right to object to offer matching (Privacy Policy, "Your
 * Rights"). Switching it off stops offers being chosen from the user's
 * figures; offers shown to everyone still appear.
 */
export function SponsoredOffersCard({
  initialOptOut,
  canChange,
}: {
  initialOptOut: boolean;
  /** False while acting as another account: the right is the owner's. */
  canChange: boolean;
}) {
  const t = useT().settings.sponsoredOffers;
  const [optOut, setOptOut] = useState(initialOptOut);
  const [isPending, startTransition] = useTransition();

  function onChange(useFigures: boolean) {
    const next = !useFigures;
    setOptOut(next);
    startTransition(async () => {
      const res = await setSponsorTargetingOptOut(next).catch(() => null);
      if (!res?.ok) {
        setOptOut(!next);
        toast.error(t.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="sponsor-targeting">{t.switchLabel}</Label>
          <Switch
            id="sponsor-targeting"
            checked={!optOut}
            onCheckedChange={onChange}
            disabled={!canChange || isPending}
          />
        </div>
        {!canChange ? (
          <p className="text-xs text-slate-500">{t.actingNote}</p>
        ) : optOut ? (
          <p className="text-xs text-slate-500">{t.offNote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
