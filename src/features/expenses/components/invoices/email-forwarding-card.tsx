import Link from "next/link";
import { Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";

interface Props {
  /**
   * User's reserved forwarding alias (local part), or null if they
   * haven't claimed one yet. When set, we show the real address and
   * link to settings; when null, we show a template and point users at
   * the claim flow.
   */
  invoiceAlias?: string | null;
  domain?: string;
}

export async function EmailForwardingCard({
  invoiceAlias = null,
  domain = "involoops.com",
}: Props) {
  const dict = await getDictionary();
  const t = dict.upload.emailForwarding;
  const hasAlias = typeof invoiceAlias === "string" && invoiceAlias.length > 0;
  const address = hasAlias ? `${invoiceAlias}@${domain}` : `{your-id}@${domain}`;

  return (
    <Card className="border-dashed" data-highlight="upload-email">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-5 w-5" />
          {t.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t.description}</p>
        <div
          dir="ltr"
          className={
            "select-none rounded-md border border-dashed bg-muted/50 px-3 py-2 text-start font-mono text-sm " +
            (hasAlias ? "text-foreground" : "text-muted-foreground")
          }
          aria-label={hasAlias ? t.yourAddressAria : t.exampleAddressAria}
        >
          {address}
        </div>
        <p className="text-xs text-muted-foreground">
          {hasAlias ? (
            t.yourAddressHint
          ) : (
            <>
              <Link
                href="/settings"
                className="font-medium text-foreground underline underline-offset-2 hover:opacity-80"
              >
                {t.reserveAddress}
              </Link>
              {t.reserveAddressSuffix}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
