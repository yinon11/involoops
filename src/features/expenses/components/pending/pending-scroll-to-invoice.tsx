"use client";

import { useEffect } from "react";

/**
 * When landing on /pending?invoice=<uuid>, scroll that card into view and briefly highlight it.
 */
export function PendingScrollToInvoice({
  invoiceId,
}: {
  invoiceId: string | undefined;
}) {
  useEffect(() => {
    if (!invoiceId) return;

    let cancelled = false;
    let frames = 0;
    const maxFrames = 48;

    function tryScroll() {
      if (cancelled) return;
      const el = document.getElementById(`pending-invoice-${invoiceId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add(
          "ring-2",
          "ring-primary/60",
          "ring-offset-2",
          "rounded-xl",
          "transition-shadow",
        );
        window.setTimeout(() => {
          el.classList.remove(
            "ring-2",
            "ring-primary/60",
            "ring-offset-2",
            "rounded-xl",
            "transition-shadow",
          );
        }, 2600);
        return;
      }
      frames += 1;
      if (frames < maxFrames) {
        requestAnimationFrame(tryScroll);
      }
    }

    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  return null;
}
