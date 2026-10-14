"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { dict } = useI18n();
  const t = dict.upload.errors;

  useEffect(() => {
    console.error("[app] segment error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t.pageLoadFailed}</h1>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          onClick={() => {
            reset();
            window.location.reload();
          }}
        >
          {dict.common.reload}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">{dict.nav.dashboard}</Link>
        </Button>
      </div>
    </div>
  );
}
