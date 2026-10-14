"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import { updateSupportContact } from "@/actions/shaam-actions";
import { Loader2, Mail } from "lucide-react";

interface Props {
  initialEmail: string;
  initialPhone: string;
}

export function SupportContactCard({ initialEmail, initialPhone }: Props) {
  const { dict } = useI18n();
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(false);
    startTransition(async () => {
      await updateSupportContact({ email, phone });
      setSaved(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          {dict.onboarding.ita.support.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-600">
          {dict.onboarding.ita.support.hint}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">
              {dict.onboarding.ita.support.contactLabel}
            </Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accountant@example.com"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {dict.onboarding.ita.support.phoneLabel}
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+972-…"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Save
          </Button>
          {saved && (
            <span className="text-xs text-green-700">{dict.common.saved}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
