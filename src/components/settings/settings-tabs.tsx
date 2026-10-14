"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

const BYOK_SECTION_HASH = "anthropic-api-key";

/**
 * Business details, Template, API keys and ITA integration each have their own
 * page in the Settings submenu, and used to ALSO be a tab here rendering the
 * very same component. Two routes editing one record is a bug waiting to
 * happen — save on one, the other still shows the old values until reload —
 * and it doubles the places a reader has to look. The submenu wins: it is
 * visible without opening a page first.
 *
 * The old `?tab=business|templates|api|integrations` deep links still resolve;
 * `normalizeTab` forwards them to the pages that own those settings.
 */
type TabValue =
  | "general"
  | "invoices"
  | "security"
  | "billing"
  | "team"
  | "data";

const VALID_TABS: TabValue[] = [
  "general",
  "invoices",
  "security",
  "billing",
  "team",
  "data",
];

/** Where a retired tab's content now lives, for old links and bookmarks. */
const MOVED_TABS: Record<string, string> = {
  business: "/creator/business-details",
  templates: "/creator/template",
  api: "/settings/api-keys",
  integrations: "/settings/ita-integration",
};

function normalizeTab(tab: string | undefined): TabValue {
  if (tab && VALID_TABS.includes(tab as TabValue)) {
    return tab as TabValue;
  }
  return "general";
}

interface SettingsTabsProps {
  initialTab?: string;
  generalTab: ReactNode;
  invoicesTab: ReactNode;
  securityTab: ReactNode;
  billingTab: ReactNode;
  teamTab: ReactNode;
  dataTab?: ReactNode;
}

export function SettingsTabs({
  initialTab,
  generalTab,
  invoicesTab,
  securityTab,
  billingTab,
  teamTab,
  dataTab,
}: SettingsTabsProps) {
  const { dict } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<TabValue>(() => normalizeTab(initialTab));

  // A bookmark to one of the retired tabs lands on the page that owns those
  // settings instead of silently dropping the reader on "General".
  useEffect(() => {
    const moved = initialTab ? MOVED_TABS[initialTab] : undefined;
    if (moved) router.replace(moved);
  }, [initialTab, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.slice(1) !== BYOK_SECTION_HASH) return;
    const id = requestAnimationFrame(() => {
      setTab("billing");
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab !== "billing") return;
    if (window.location.hash.slice(1) !== BYOK_SECTION_HASH) return;

    const t = window.setTimeout(() => {
      document.getElementById(BYOK_SECTION_HASH)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
    return () => window.clearTimeout(t);
  }, [tab]);

  const extraTabs = [
    dataTab && { value: "data" as const, label: dict.settings.tabs.data, content: dataTab },
  ].filter(Boolean) as { value: TabValue; label: string; content: ReactNode }[];

  const totalCols = 5 + extraTabs.length;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-6 w-6 text-indigo-500" />
        <h1 className="text-2xl font-bold tracking-tight">{dict.settings.title}</h1>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="w-full">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
          <TabsList
            className="mb-6 flex w-max min-w-full gap-1 p-1 sm:w-full sm:gap-0"
            style={{ gridTemplateColumns: `repeat(${totalCols}, 1fr)` }}
          >
            <TabsTrigger value="general" className="text-xs sm:text-sm">
              {dict.settings.tabs.general}
            </TabsTrigger>
            <TabsTrigger value="invoices" className="text-xs sm:text-sm">
              {dict.settings.tabs.invoices}
            </TabsTrigger>
            <TabsTrigger value="security" className="text-xs sm:text-sm">
              {dict.settings.tabs.security}
            </TabsTrigger>
            <TabsTrigger value="billing" className="text-xs sm:text-sm">
              {dict.settings.tabs.billing}
            </TabsTrigger>
            <TabsTrigger value="team" className="text-xs sm:text-sm">
              {dict.settings.tabs.team}
            </TabsTrigger>
            {extraTabs.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} className="text-xs sm:text-sm">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="general" className="mt-6">
          <div className="space-y-6">{generalTab}</div>
        </TabsContent>
        <TabsContent value="invoices" className="mt-6">
          <div className="space-y-6">{invoicesTab}</div>
        </TabsContent>
        <TabsContent value="security" className="mt-6">
          <div className="space-y-6">{securityTab}</div>
        </TabsContent>
        <TabsContent value="billing" className="mt-6">
          <div className="space-y-6">{billingTab}</div>
        </TabsContent>
        <TabsContent value="team" className="mt-6">
          <div className="space-y-6">{teamTab}</div>
        </TabsContent>
        {extraTabs.map(({ value, content }) => (
          <TabsContent key={value} value={value} className="mt-6">
            <div className="space-y-6">{content}</div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
