"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import {
  listDeviceSessions,
  revokeDeviceSession,
  type DeviceSessionListItem,
} from "@/actions/device-session-actions";

const copy = {
  en: {
    title: "Signed-in phones",
    description:
      "Phones that signed in to the InvoLoops app. Revoking a phone signs it out the next time it talks to the server.",
    empty: "No phones are signed in.",
    revoke: "Sign out",
    lastUsed: "Last used",
    never: "Not yet",
  },
  he: {
    title: "טלפונים מחוברים",
    description:
      "טלפונים שנכנסו לאפליקציית InvoLoops. ניתוק טלפון מוציא אותו מהחשבון בפעם הבאה שהוא פונה לשרת.",
    empty: "אין טלפונים מחוברים.",
    revoke: "ניתוק",
    lastUsed: "שימוש אחרון",
    never: "עדיין לא",
  },
} as const;

export function DeviceSessionsCard({
  initialSessions,
}: {
  initialSessions: DeviceSessionListItem[];
}) {
  const { locale, tag } = useI18n();
  const t = locale === "he" ? copy.he : copy.en;
  const [sessions, setSessions] = useState(initialSessions);
  const [pending, startTransition] = useTransition();

  function revoke(id: string) {
    startTransition(async () => {
      await revokeDeviceSession(id);
      setSessions(await listDeviceSessions());
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          {t.title}
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.deviceName}</p>
                <p className="text-xs text-muted-foreground">
                  {t.lastUsed}{" "}
                  {session.lastUsedAt
                    ? new Date(session.lastUsedAt).toLocaleString(tag)
                    : t.never}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => revoke(session.id)}
              >
                {t.revoke}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
