"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { deleteInvoice } from "@/features/expenses/actions/invoice-actions";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

export function DeleteInvoiceButton({
  invoiceId,
  label,
  onDeleted,
  variant = "icon",
}: {
  invoiceId: string;
  label: string;
  /** Called after successful delete (e.g. clear selection on pending queue). */
  onDeleted?: () => void;
  /** `icon` = table row; `compact` = icon + label for toolbars. */
  variant?: "icon" | "compact";
}) {
  const router = useRouter();
  const dict = useT();
  const t = dict.invoices.deleteButton;

  function handleClick() {
    toast(t.confirmTitle, {
      description: format(t.confirmDescription, { label }),
      action: {
        label: dict.common.delete,
        onClick: () => {
          void (async () => {
            try {
              await deleteInvoice(invoiceId);
              toast.success(t.deleted);
              onDeleted?.();
              router.refresh();
            } catch (e) {
              toast.error(
                e instanceof Error ? e.message : t.failed
              );
            }
          })();
        },
      },
      cancel: {
        label: dict.common.cancel,
        onClick: () => {},
      },
    });
  }

  if (variant === "compact") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={handleClick}
        title={t.buttonTitle}
      >
        <Trash2 className="me-1 h-4 w-4" />
        {dict.common.delete}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-destructive hover:text-destructive"
      onClick={handleClick}
      title={t.buttonTitle}
    >
      <Trash2 className="h-4 w-4" />
      <span className="sr-only">{t.buttonTitle}</span>
    </Button>
  );
}
