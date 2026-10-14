"use client";

import { useState } from "react";
import { signOutAction } from "@/actions/auth-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n/client";

export function SignOutMenuItem() {
  const dict = useT();
  const [pending, setPending] = useState(false);

  return (
    <DropdownMenuItem
      disabled={pending}
      className="cursor-pointer"
      onSelect={async (event) => {
        event.preventDefault();
        setPending(true);
        await signOutAction();
      }}
    >
      {pending ? `${dict.common.signOut}…` : dict.common.signOut}
    </DropdownMenuItem>
  );
}
