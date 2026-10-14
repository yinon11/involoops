"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

/**
 * A collapsible sidebar section.
 *
 * Only the open/closed toggle lives on the client. The header icon and the
 * item rows arrive as already-rendered `ReactNode`s from the server component
 * that owns the nav tree — passing a render function or an icon *component*
 * across that boundary is not allowed ("Functions cannot be passed directly to
 * Client Components"), and doing so 500s the whole page.
 *
 * Open/closed is seeded from the route: the section containing the current
 * page starts open, the rest start closed. Voice navigation can expand every
 * section so menu items stay clickable.
 */
export function SidebarSection({
  heading,
  sectionKey,
  icon,
  itemHrefs,
  badgeTotal = 0,
  children,
}: {
  heading: string;
  sectionKey?: string;
  icon?: ReactNode;
  /** Hrefs of the rows inside, used only to decide the default open state. */
  itemHrefs: readonly string[];
  badgeTotal?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();

  const containsActive = itemHrefs.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
  const [open, setOpen] = useState(containsActive);
  const showBadge = !open && badgeTotal > 0;

  // Navigating into a section opens it; the user can still collapse it
  // afterwards, so this is a one-way nudge rather than a mirror of the prop.
  //
  // Adjusting state during render on a changed input is React's documented
  // alternative to an effect for this ("storing information from previous
  // renders"): React restarts the render immediately with the new state,
  // without the extra commit-and-re-render an effect costs.
  const [wasContainsActive, setWasContainsActive] = useState(containsActive);
  if (containsActive !== wasContainsActive) {
    setWasContainsActive(containsActive);
    if (containsActive) setOpen(true);
  }

  useEffect(() => {
    const onExpand = (event: Event) => {
      const detail = (event as CustomEvent<{ all?: boolean; href?: string }>).detail;
      if (detail?.all) {
        setOpen(true);
        return;
      }
      const href = detail?.href;
      if (
        href &&
        itemHrefs.some((item) => href === item || href.startsWith(`${item}/`))
      ) {
        setOpen(true);
      }
    };
    window.addEventListener("involoops:expand-nav", onExpand);
    return () => window.removeEventListener("involoops:expand-nav", onExpand);
  }, [itemHrefs]);

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-highlight={sectionKey ? `nav-section-${sectionKey}` : undefined}
        data-voice-action={sectionKey ? `nav-section-${sectionKey}` : undefined}
        className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-start">{heading}</span>
        {showBadge ? (
          <span className="min-w-[1.25rem] shrink-0 rounded-full bg-amber-500 px-1.5 text-center text-[10px] font-semibold text-white tabular-nums">
            {badgeTotal > 99 ? "99+" : badgeTotal}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? "" : "-rotate-90 rtl:rotate-90"
          }`}
        />
      </button>

      {/* The rail sits under the header icon so children hang off it. */}
      {open ? (
        <div className="ms-[1.3rem] space-y-0.5 border-s border-slate-200 ps-2.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
