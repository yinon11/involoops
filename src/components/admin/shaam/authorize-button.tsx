"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startShaamAuthorization } from "@/actions/shaam-actions";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";
import { ExternalLink, Loader2 } from "lucide-react";

interface Props {
  businessEntityId: string;
  environment: ShaamEnvironment;
  label: string;
}

export function ShaamAuthorizeButton({
  businessEntityId,
  environment,
  label,
}: Props) {
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const { authorizationUrl } = await startShaamAuthorization({
          businessEntityId,
          environment,
        });
        window.location.href = authorizationUrl;
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Button
      size="sm"
      onClick={run}
      disabled={isPending}
      className="gap-1"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ExternalLink className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );
}
