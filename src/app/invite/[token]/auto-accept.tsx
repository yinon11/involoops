"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { acceptTeamInvitation } from "@/actions/team-invitation-actions";
import { switchAccountAction } from "@/actions/account-link-actions";

interface AutoAcceptProps {
  token: string;
  ownerUserId: string;
  acceptingLabel: string;
  acceptedLabel: string;
}

/**
 * Fires on mount when the signed-in user matches the invitation:
 *   1. Calls the accept action to materialise the account_links row.
 *   2. Switches the user straight into the owner's account via the
 *      switch-account credentials provider, which re-verifies the link
 *      directly from the DB — so the user lands on the owner's
 *      dashboard with no need to wait for the existing JWT to refresh
 *      its linkedAccounts cache.
 *
 * Idempotency: a `useRef` gate guards against React's double-invocation
 * in dev (StrictMode). The accept action itself is also idempotent —
 * re-accepting refreshes capabilities on the existing link.
 */
export function AutoAccept({
  token,
  ownerUserId,
  acceptingLabel,
  acceptedLabel,
}: AutoAcceptProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"accepting" | "accepted">("accepting");
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    (async () => {
      const result = await acceptTeamInvitation(token);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPhase("accepted");
      try {
        await switchAccountAction(ownerUserId);
      } catch {
        // switchAccountAction throws NEXT_REDIRECT on success. If we land
        // here it's a real failure — fall back to the user's own
        // dashboard so the avatar menu's "switch account" surfaces the
        // newly-linked owner on next session refresh.
        router.push("/dashboard");
      }
    })();
  }, [token, ownerUserId, router]);

  if (error) {
    return (
      <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
    );
  }

  return (
    <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">
      {phase === "accepting" ? acceptingLabel : acceptedLabel}
    </p>
  );
}
