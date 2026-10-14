"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mail, Loader2, Trash2, Send } from "lucide-react";
import {
  addAuthorizedSenderAction,
  removeAuthorizedSenderAction,
  resendAuthorizedSenderAction,
  type AuthorizedSenderView,
} from "@/features/expenses/actions/authorized-sender-actions";
import { useI18n } from "@/lib/i18n/client";

interface Props {
  initialSenders: AuthorizedSenderView[];
}

export function AuthorizedSendersCard({ initialSenders }: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.settings.authorizedSenders;
  const [, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const senders = initialSenders;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addAuthorizedSenderAction(email);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmail("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.addFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const result = await resendAuthorizedSenderAction(id);
      if (!result.ok) setError(result.error);
    } finally {
      setPendingId(null);
    }
  }

  async function handleRemove(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const result = await removeAuthorizedSenderAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          {t.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t.description}</p>

        <form onSubmit={handleAdd} className="flex items-start gap-2">
          <Input
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.addPlaceholder}
            className="flex-1"
            disabled={busy}
            aria-label={t.title}
          />
          <Button type="submit" size="sm" disabled={busy || !email.trim()}>
            {busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
            {busy ? t.adding : t.addButton}
          </Button>
        </form>

        {senders.length > 0 ? (
          <ul className="space-y-2">
            {senders.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2"
              >
                <code
                  className="flex-1 truncate font-mono text-sm text-start"
                  dir="ltr"
                >
                  {s.email}
                </code>
                <Badge variant={s.verified ? "default" : "secondary"}>
                  {s.verified ? t.verified : t.pending}
                </Badge>
                {!s.verified && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2"
                    onClick={() => handleResend(s.id)}
                    disabled={pendingId === s.id}
                    aria-label={t.resend}
                  >
                    {pendingId === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-red-600 hover:text-red-700"
                  onClick={() => handleRemove(s.id)}
                  disabled={pendingId === s.id}
                  aria-label={t.remove}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t.emptyHint}</p>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
