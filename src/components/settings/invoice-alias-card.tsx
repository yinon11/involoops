"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, Copy, Check } from "lucide-react";
import { claimInvoiceAliasAction } from "@/features/expenses/actions/invoice-alias-actions";
import { useI18n } from "@/lib/i18n/client";

interface Props {
  /** Current alias from the DB, or null if the user hasn't claimed one yet. */
  initialAlias: string | null;
  /** Hostname used in the full address. Defaults to involoops.com. */
  domain?: string;
}

export function InvoiceAliasCard({ initialAlias, domain = "involoops.com" }: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.settings.invoiceAlias;
  const [isPending, startTransition] = useTransition();
  const [alias, setAlias] = useState<string | null>(initialAlias);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullAddress = alias ? `${alias}@${domain}` : null;

  async function handleClaim() {
    setBusy(true);
    setError(null);
    try {
      const result = await claimInvoiceAliasAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAlias(result.alias);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.claimFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!fullAddress) return;
    try {
      await navigator.clipboard.writeText(fullAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in insecure contexts; silently ignore — the
      // address is visible on screen for the user to select manually.
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

        {fullAddress ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
              <code
                className="flex-1 truncate font-mono text-sm text-start"
                dir="ltr"
              >
                {fullAddress}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-7 shrink-0 px-2"
                disabled={isPending}
                aria-label={t.copyAria}
              >
                {copied ? (
                  <>
                    <Check className="me-1 h-3.5 w-3.5" />
                    {t.copied}
                  </>
                ) : (
                  <>
                    <Copy className="me-1 h-3.5 w-3.5" />
                    {t.copy}
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t.addressHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              type="button"
              onClick={handleClaim}
              disabled={busy || isPending}
              size="sm"
            >
              {busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {t.reserveButton}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t.reserveHintPart1}
              <code dir="ltr">{domain}</code>
              {t.reserveHintPart2}
            </p>
          </div>
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
