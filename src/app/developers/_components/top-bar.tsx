"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code2, BookOpen, FileJson, ArrowLeft, Boxes, Plug } from "lucide-react";
import { ROUTE_PATHS } from "./_routes";

const NAV_ITEMS = [
  { href: ROUTE_PATHS.userGuide, label: "User guide", icon: BookOpen },
  { href: ROUTE_PATHS.guide, label: "API", icon: Code2 },
  { href: ROUTE_PATHS.swagger, label: "API Reference", icon: Boxes },
  { href: ROUTE_PATHS.playground, label: "Playground", icon: Plug },
] as const;

export function DevsTopBar({ showBackToApp = true }: { showBackToApp?: boolean }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/developers"
            className="flex items-center gap-2 text-sm font-semibold text-slate-900"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <Code2 className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">InvoLoops Developers</span>
            <span className="sm:hidden">Devs</span>
          </Link>
        </div>

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === ROUTE_PATHS.guide
                ? pathname === ROUTE_PATHS.guide
                : item.href === ROUTE_PATHS.userGuide
                  ? pathname === item.href || pathname?.startsWith(`${item.href}/`)
                  : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={ROUTE_PATHS.openapiSpec}
            className="hidden items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 sm:inline-flex"
            title="Download the raw OpenAPI 3.1 spec"
          >
            <FileJson className="h-3.5 w-3.5" />
            openapi.json
          </a>
          {showBackToApp && (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">App</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
