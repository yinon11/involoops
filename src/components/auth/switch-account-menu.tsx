"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight, Users } from "lucide-react";
import { switchAccountAction } from "@/actions/account-link-actions";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { LinkedAccount, SessionOriginator } from "@/types/auth";

type Props = {
  linkedAccounts: LinkedAccount[];
  originator: SessionOriginator | null;
  /**
   * When true and the session is acting-as, the member is locked into the
   * owner's account ("Sign in directly to my account") and switch-back is
   * hidden. Server-side `switchAccountAction` also rejects the switch-back.
   */
  originatorLocked?: boolean;
};

/**
 * Rendered inside the avatar dropdown. Shows:
 *  - a "Switch back to {originator}" row when the current session is acting-as,
 *  - or a list of linked accounts the current user can switch into.
 *
 * When acting-as, linkedAccounts is empty (enforced server-side in the jwt
 * callback) so only one of the two sections ever shows.
 *
 * When the acting-as session is locked to the owner, nothing is rendered: the
 * member always stays inside the owner's account.
 */
export function SwitchAccountMenu({
  linkedAccounts,
  originator,
  originatorLocked = false,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (!originator && linkedAccounts.length === 0) {
    return null;
  }

  if (originator && originatorLocked) {
    return null;
  }

  const handleSwitch = (targetUserId: string, viaSwitchBack = false) => {
    setPendingId(targetUserId);
    startTransition(async () => {
      const result = await switchAccountAction(targetUserId, viaSwitchBack);
      if (result?.error) {
        setPendingId(null);
      }
    });
  };

  return (
    <>
      <DropdownMenuSeparator />
      {originator ? (
        <>
          <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2 text-xs font-normal uppercase tracking-wider">
            <ArrowLeftRight className="h-3 w-3" />
            Acting as
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={pendingId !== null}
            className="cursor-pointer"
            onSelect={(event) => {
              event.preventDefault();
              handleSwitch(originator.id, true);
            }}
          >
            {pendingId === originator.id
              ? "Switching…"
              : `Switch back to ${originator.name ?? originator.email}`}
          </DropdownMenuItem>
        </>
      ) : (
        <>
          <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2 text-xs font-normal uppercase tracking-wider">
            <Users className="h-3 w-3" />
            Switch account
          </DropdownMenuLabel>
          {linkedAccounts.map((account) => {
            const label = account.companyName ?? account.name ?? account.email;
            const isPending = pendingId === account.id;
            return (
              <DropdownMenuItem
                key={account.id}
                disabled={pendingId !== null}
                className="cursor-pointer"
                onSelect={(event) => {
                  event.preventDefault();
                  handleSwitch(account.id);
                }}
              >
                <div className="flex flex-col">
                  <span className="text-sm">
                    {isPending ? "Switching…" : label}
                  </span>
                  {!isPending && label !== account.email && (
                    <span className="text-muted-foreground text-xs">
                      {account.email}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            );
          })}
        </>
      )}
    </>
  );
}
