"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  /** Other sibling hrefs in the same nav. Used so the longest-matching prefix wins. */
  siblingHrefs?: readonly string[];
  /** Match only when pathname equals href exactly. Defaults to false (prefix match). */
  exact?: boolean;
  className?: string;
  /** Classes appended only when the link is the active route. */
  activeClassName?: string;
  /** Stable key written to `data-highlight` on the link. */
  highlightKey?: string;
  children: ReactNode;
}

function isActiveHref(
  pathname: string,
  href: string,
  siblingHrefs: readonly string[] | undefined,
  exact: boolean,
): boolean {
  if (pathname === href) return true;
  if (exact) return false;
  // Special-case "/" so it doesn't match every route.
  if (href === "/") return false;
  if (!pathname.startsWith(`${href}/`)) return false;
  if (!siblingHrefs) return true;
  // Longest-prefix wins: if another sibling is a more specific match, this one is not active.
  for (const other of siblingHrefs) {
    if (other === href) continue;
    if (other.length <= href.length) continue;
    if (pathname === other || pathname.startsWith(`${other}/`)) {
      return false;
    }
  }
  return true;
}

export function NavLink({
  href,
  siblingHrefs,
  exact = false,
  className,
  activeClassName,
  highlightKey,
  children,
}: NavLinkProps) {
  const pathname = usePathname() ?? "";
  const active = isActiveHref(pathname, href, siblingHrefs, exact);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : undefined}
      data-highlight={highlightKey}
      className={cn(className, active && activeClassName)}
    >
      {children}
    </Link>
  );
}
