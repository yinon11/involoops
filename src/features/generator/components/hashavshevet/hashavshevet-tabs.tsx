"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

const SETTINGS_HREF = "/outbound/hashavshevet";
const EXPORT_HREF = "/outbound/hashavshevet/export";

export function HashavshevetTabs() {
  const pathname = usePathname();
  const { dict } = useI18n();
  const t = dict.hashavshevet.tabs;

  const tabs = [
    { href: SETTINGS_HREF, label: t.settings, exact: true },
    { href: EXPORT_HREF, label: t.export, exact: false },
  ];

  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-white p-1">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
