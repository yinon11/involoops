"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface MobileNavDrawerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Side to anchor the drawer. Defaults to the reading-flow start. */
  side?: "start" | "end";
  /**
   * `icon` is the header hamburger. `tab` is a bottom-bar item with a label.
   * The button is rendered here, not passed in: a trigger element created in a
   * Server Component is dropped by the dialog trigger and never reaches the DOM.
   */
  variant?: "icon" | "tab";
  /** Tailwind classes applied to the drawer panel (e.g. background, text color). */
  panelClassName?: string;
  /** Tailwind classes applied to the trigger button. */
  triggerClassName?: string;
  children: ReactNode;
}

/**
 * Side-anchored drawer for shell navigation on phones/tablets. Auto-closes
 * when the pathname changes so tapping a nav link actually dismisses it.
 */
export function MobileNavDrawer({
  title,
  subtitle,
  side = "start",
  variant = "icon",
  panelClassName,
  triggerClassName,
  children,
}: MobileNavDrawerProps) {
  const dict = useT();
  const [open, setOpen] = useState(false);

  // Close when the user taps a link inside the drawer. We can't rely on
  // pathname-based effects without tripping react-hooks/set-state-in-effect,
  // and this covers the same UX: every nav target lives inside children.
  const handleContentClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("a")) {
      setOpen(false);
    }
  };

  const anchor =
    side === "start"
      ? "start-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left"
      : "end-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={dict.shell.app.openMenu}
          className={cn(
            variant === "tab"
              ? "flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-900"
              : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-transparent text-current transition-colors hover:bg-slate-100 md:hidden",
            triggerClassName,
          )}
        >
          <Menu className="h-5 w-5 shrink-0" />
          {variant === "tab" ? (
            <span className="line-clamp-2 w-full text-center leading-tight">
              {dict.shell.app.mobileMore}
            </span>
          ) : null}
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 z-50 flex w-[min(18rem,85vw)] flex-col overflow-y-auto bg-white shadow-xl duration-200 md:hidden",
            anchor,
            panelClassName,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description className="truncate text-[11px] opacity-70">
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label={dict.common.close}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 px-3 py-4" onClick={handleContentClick}>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
