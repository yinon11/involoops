"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { reExtractInvoice } from "@/features/expenses/actions/invoice-actions";
import { useInvoiceReextractContext } from "./invoice-reextract-context";
import { useT } from "@/lib/i18n/client";

export function ReExtractInvoiceButton({
  invoiceId,
  hasFile,
}: {
  invoiceId: string;
  hasFile: boolean;
}) {
  const router = useRouter();
  const t = useT().invoices.reExtract;
  const [pending, startTransition] = useTransition();
  const { onComplete } = useInvoiceReextractContext();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await reExtractInvoice(invoiceId);
        if (!result.success) throw new Error(result.error);
        if (onComplete) {
          await onComplete();
        } else {
          router.refresh();
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : t.failed);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      disabled={!hasFile || pending}
      title={t.title}
      onClick={handleClick}
    >
      <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      <span className="sr-only">{t.srLabel}</span>
    </Button>
  );
}
