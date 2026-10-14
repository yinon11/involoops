"use client";

import { useTransition } from "react";
import { ChevronDown, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InvoloopsStudioMark } from "@/components/brand/involoops-studio-mark";
import { switchMode } from "@/actions/mode-actions";
import type { AppMode } from "@/lib/mode";

/**
 * The brand mark in the sidebar header.
 *
 * This used to be a product switcher between InvoLoops and InvoLoops Studio.
 * Those are one app now — both names survive as marketing, not as modes — so
 * for everyone except platform admins this is simply the brand. Admins keep a
 * dropdown, because the admin console is a genuinely different shell.
 */
export function BrandProductSwitcher({
  currentMode,
  isAdmin,
  labels,
  compact = false,
  variant = "light",
}: {
  currentMode: AppMode;
  isAdmin: boolean;
  labels: { expense: string; creator: string; admin: string; title: string };
  compact?: boolean;
  variant?: "light" | "admin";
}) {
  const [isPending, startTransition] = useTransition();
  const isAdminVariant = variant === "admin";
  const markSize = compact ? 26 : 32;
  const inAdmin = currentMode === "admin";

  const brand = (
    <>
      {inAdmin ? (
        <span
          className={`flex shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
        >
          <Shield className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </span>
      ) : (
        <InvoloopsStudioMark size={markSize} color="#7C3AED" className="shrink-0" />
      )}
      <span
        className={`block min-w-0 flex-1 truncate font-semibold ${isAdminVariant ? "text-sm text-zinc-100" : "text-[17px] text-[#0B1220]"}`}
        style={
          isAdminVariant
            ? undefined
            : {
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                letterSpacing: "-0.035em",
              }
        }
      >
        {inAdmin ? labels.admin : labels.expense}
      </span>
    </>
  );

  const rowClass = isAdminVariant
    ? "flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-start text-zinc-100"
    : "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 text-start";

  // Non-admins have nowhere to switch to, so render a plain brand row rather
  // than a dropdown that opens onto a single disabled option.
  if (!isAdmin) {
    return <div className={rowClass}>{brand}</div>;
  }

  function go(next: AppMode) {
    if (next === currentMode) return;
    startTransition(async () => {
      const result = await switchMode(next);
      if (result.ok) window.location.assign(result.href);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${rowClass} transition-colors focus:outline-none disabled:opacity-60 ${isAdminVariant ? "hover:bg-zinc-800" : "hover:bg-slate-100"}`}
        disabled={isPending}
      >
        {brand}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 opacity-70 ${isAdminVariant ? "text-zinc-400" : "text-slate-500"}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            go(inAdmin ? "expense" : "admin");
          }}
          disabled={isPending}
          className="flex cursor-pointer items-center gap-2"
        >
          {inAdmin ? (
            <InvoloopsStudioMark size={16} color="#7C3AED" className="shrink-0" />
          ) : (
            <Shield className="h-4 w-4 shrink-0 text-amber-600" />
          )}
          <span className="truncate">
            {inAdmin ? labels.expense : labels.admin}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
