"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { revokeShaamAuthorization } from "@/actions/shaam-actions";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";
import { Loader2, Unlink } from "lucide-react";

interface Props {
  businessEntityId: string;
  environment: ShaamEnvironment;
  label: string;
}

export function ShaamRevokeButton({
  businessEntityId,
  environment,
  label,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run() {
    if (!confirm("Revoke ITA authorization?")) return;
    startTransition(async () => {
      try {
        await revokeShaamAuthorization({ businessEntityId, environment });
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={run}
      disabled={isPending}
      className="gap-1 text-red-700 hover:bg-red-50"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Unlink className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );
}
