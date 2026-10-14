import Link from "next/link";
import {
  Banknote,
  BookOpen,
  BookOpenCheck,
  Briefcase,
  Building2,
  Code,
  Copy,
  FileStack,
  FileText,
  FolderKanban,
  HandCoins,
  Home,
  Key,
  LayoutDashboard,
  Palette,
  Plug,
  Receipt,
  Send,
  Settings as SettingsIcon,
  TrendingDown,
  Upload,
  Users,
} from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutMenuItem } from "@/components/auth/sign-out-menu-item";
import { SwitchAccountMenu } from "@/components/auth/switch-account-menu";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { DeletionBanner } from "@/components/shared/deletion-banner";
import { UnverifiedEmailBanner } from "@/components/auth/unverified-email-banner";
import { MobileNavDrawer } from "@/components/shell/mobile-nav-drawer";
import { NavLink } from "@/components/shell/nav-link";
import { RecommendationsBell } from "@/features/generator/components/recommendations/recommendations-bell";
import {
  getRecommendations,
  getUnreadRecommendationCount,
} from "@/features/generator/actions/recommendation-actions";
import { BrandProductSwitcher } from "@/components/shell/brand-product-switcher";
import { SidebarSection } from "@/components/shell/sidebar-section";
import { NewMenu } from "@/components/shell/new-menu";
import { HeaderSponsor } from "@/components/shell/header-sponsor";
import type { AppMode } from "@/lib/mode";
import type { ShellNavIcon, ShellNavItem, ShellNavSection } from "./app-shell-nav-types";

type Icon = ShellNavIcon;

interface AppShellLabels {
  brand: string;
  groupBusiness: string;
  groupIncome: string;
  groupTaxes: string;
  groupHelp: string;
  newMenu: string;
  documents: string;
  collections: string;
  overview: string;
  uniformStructure: string;
  hashavshevet: string;
  itaIntegration: string;
  itaGuide: string;
  general: string;
  businessDetails: string;
  template: string;
  apiKeys: string;
  developers: string;
  groupMore: string;
  home: string;
  sendInvoice: string;
  addExpense: string;
  moneyIn: string;
  moneyOut: string;
  vatEstimates: string;
  projects: string;
  clients: string;
  settings: string;
  tutorials: string;
  groupExpenses: string;
  invoices: string;
  pending: string;
  duplicates: string;
  vendors: string;
}

export interface CreatorShellNavLabels {
  home: string;
  invoices: string;
  newInvoice: string;
  customers: string;
  collections: string;
  projects: string;
  taxEstimates: string;
  hashavshevet: string;
  uniformStructure: string;
  template: string;
  businessDetails: string;
  itaIntegration: string;
  tutorial: string;
  apiKeys: string;
  developers: string;
}

export interface CreatorSidebarBundle {
  brand: string;
  setupHeading: string;
  nav: CreatorShellNavLabels;
}

interface AppShellProps {
  children: ReactNode;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    linkedAccounts?: unknown;
    originator?: unknown;
    originatorLocked?: boolean;
  };
  /** Hides /settings link when a team member is acting-as without manage_settings. */
  canManageSettings: boolean;
  isEmailVerified: boolean;
  userEmail: string | null;
  initials: string;
  isAdmin: boolean;
  appMode: AppMode;
  /** Drives the amber badge on the Pending nav item. */
  pendingCount: number;
  modeSwitcherLabels: {
    expense: string;
    creator: string;
    admin: string;
    title: string;
  };
  labels: AppShellLabels;
}

/**
 * The one navigation tree.
 *
 * There is no expense/creator split any more: both products are sections of
 * the same app. Two rules keep it from drifting back into a mess —
 *
 *   1. Every route appears exactly once. `/clients` folded into `/customers`;
 *      creating lives in the New menu, not duplicated per section.
 *   2. Sections are grouped by the question being asked (what came in, what
 *      went out, what do I owe), not by which half of the product owns the
 *      table behind it. Taxes reads both sides, which is why it is top level.
 */
function buildSections(
  labels: AppShellLabels,
  canManageSettings: boolean,
  pendingCount: number,
): ShellNavSection[] {
  return [
    {
      heading: "",
      items: [{ key: "home", href: "/", icon: Home, label: labels.home }],
    },
    {
      heading: labels.groupIncome,
      sectionKey: "income",
      icon: Banknote,
      collapsible: true,
      items: [
        // "Overview" and "Money In" were two entries answering the same
        // question from different ends; they are one page now (/creator
        // redirects). Mirrors the Expenses group, which also opens on
        // a single Overview.
        { key: "moneyIn", href: "/money-in", icon: LayoutDashboard, label: labels.overview },
        { key: "outbound", href: "/outbound", icon: FileText, label: labels.documents },
        { key: "collections", href: "/outbound/collections", icon: HandCoins, label: labels.collections },
        { key: "customers", href: "/customers", icon: Users, label: labels.clients },
      ],
    },
    {
      heading: labels.groupExpenses,
      sectionKey: "expenses",
      icon: TrendingDown,
      collapsible: true,
      items: [
        { key: "moneyOut", href: "/money-out", icon: LayoutDashboard, label: labels.overview },
        { key: "pending", href: "/pending", icon: BookOpenCheck, label: labels.pending, badge: pendingCount },
        { key: "duplicates", href: "/duplicates", icon: Copy, label: labels.duplicates },
        { key: "vendors", href: "/vendors", icon: Building2, label: labels.vendors },
      ],
    },
    {
      // Both directions live on this page, so it is not inside Expenses.
      heading: "",
      items: [
        { key: "invoices", href: "/invoices", icon: Receipt, label: labels.invoices },
      ],
    },
    {
      heading: labels.groupTaxes,
      sectionKey: "taxes",
      icon: FileStack,
      collapsible: true,
      items: [
        { key: "vatEstimates", href: "/outbound/tax-estimates", icon: Receipt, label: labels.vatEstimates },
        { key: "uniformStructure", href: "/outbound/uniform-structure", icon: FileStack, label: labels.uniformStructure },
        { key: "hashavshevet", href: "/outbound/hashavshevet", icon: Briefcase, label: labels.hashavshevet },
        { key: "ita", href: "/settings/ita-integration", icon: Plug, label: labels.itaIntegration },
      ],
    },
    {
      heading: "",
      items: [
        { key: "projects", href: "/outbound/projects", icon: FolderKanban, label: labels.projects },
      ],
    },
    ...(canManageSettings
      ? [
          {
            heading: labels.settings,
            sectionKey: "settings",
            icon: SettingsIcon,
            collapsible: true,
            items: [
              { key: "settings", href: "/settings", icon: SettingsIcon, label: labels.general },
              { key: "businessDetails", href: "/creator/business-details", icon: Building2, label: labels.businessDetails },
              { key: "template", href: "/creator/template", icon: Palette, label: labels.template },
              { key: "apiKeys", href: "/settings/api-keys", icon: Key, label: labels.apiKeys },
              { key: "developers", href: "/developers", icon: Code, label: labels.developers },
            ],
          } as ShellNavSection,
        ]
      : []),
    {
      heading: labels.groupHelp,
      sectionKey: "help",
      icon: BookOpen,
      collapsible: true,
      items: [
        { key: "tutorials", href: "/tutorials", icon: BookOpen, label: labels.tutorials },
        { key: "itaGuide", href: "/tutorials/ita-integration", icon: BookOpenCheck, label: labels.itaGuide },
      ],
    },
  ];
}

function buildMobilePrimaryRow(
  labels: AppShellLabels,
): Array<{ href: string; icon: Icon; label: string; exact?: boolean }> {
  return [
    { href: "/", icon: Home, label: labels.home, exact: true },
    { href: "/outbound/new", icon: Send, label: labels.sendInvoice },
    { href: "/invoices/upload", icon: Upload, label: labels.addExpense },
  ];
}

export async function AppShell({
  children,
  user,
  canManageSettings,
  isEmailVerified,
  userEmail,
  initials,
  isAdmin,
  appMode,
  pendingCount,
  modeSwitcherLabels,
  labels,
}: AppShellProps) {
  const sections = buildSections(labels, canManageSettings, pendingCount);
  const allItems = sections.flatMap((s) => s.items);
  const siblingHrefs = allItems.map((i) => i.href);

  const mobilePrimary = buildMobilePrimaryRow(labels);

  const [bellRecs, unreadCount] = await Promise.all([
    getRecommendations().catch(() => []),
    getUnreadRecommendationCount().catch(() => 0),
  ]);

  const brandSwitcher = (
    <BrandProductSwitcher
      currentMode={appMode}
      isAdmin={isAdmin}
      labels={modeSwitcherLabels}
    />
  );

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      <DeletionBanner />

      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        {/* Sticky so the nav stays put while the page scrolls; it gets its own
            scrollbar for when the section list is taller than the viewport. */}
        <aside className="hidden w-60 shrink-0 flex-col border-e border-slate-200/80 bg-white/80 backdrop-blur md:sticky md:top-0 md:flex md:h-dvh md:overflow-y-auto">
          <div className="border-b border-slate-200/80 px-5 py-5">
            {brandSwitcher}
          </div>

          <div className="px-3 pt-4">
            <NewMenu
              labels={{
                new: labels.newMenu,
                issueDocument: labels.sendInvoice,
                uploadExpense: labels.addExpense,
              }}
            />
          </div>

          <nav className="flex-1 space-y-1 px-3 py-4">
            {sections.map((section, i) =>
              section.collapsible ? (
                <SidebarSection
                  key={section.heading || i}
                  heading={section.heading}
                  sectionKey={section.sectionKey}
                  icon={
                    section.icon ? (
                      <section.icon className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-slate-700" />
                    ) : null
                  }
                  itemHrefs={section.items.map((it) => it.href)}
                  badgeTotal={section.items.reduce(
                    (sum, it) => sum + (it.badge ?? 0),
                    0,
                  )}
                >
                  {section.items.map((item) => (
                    <SidebarNavLink
                      key={item.key}
                      item={item}
                      siblingHrefs={siblingHrefs}
                      nested
                    />
                  ))}
                </SidebarSection>
              ) : (
                <div key={section.heading || i} className="space-y-0.5">
                  {section.items.map((item) => (
                    <SidebarNavLink
                      key={item.key}
                      item={item}
                      siblingHrefs={siblingHrefs}
                    />
                  ))}
                </div>
              ),
            )}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-[#FAFAF7]/85 px-4 py-3 backdrop-blur-md sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-initial md:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-1 md:hidden">
                <MobileNavDrawer title={labels.brand}>
                  <MobileSectionList sections={sections} />
                </MobileNavDrawer>
                <div className="min-w-0 flex-1">
                  <BrandProductSwitcher
                    currentMode={appMode}
                    isAdmin={isAdmin}
                    labels={modeSwitcherLabels}
                    compact
                  />
                </div>
              </div>
            </div>
            {/* Sponsored slot. Beside the language switcher on wide screens;
                on phones the bar has no room left, so it wraps to a slim
                full-width second row. `empty:hidden` keeps that row from
                existing at all when there is no offer. `-ms-8` cancels the
                header's inline-start padding plus the flex gap after the
                (desktop-empty) brand cell, so the creative runs right up to
                the sidebar instead of stopping 32px short. */}
            <div className="order-last basis-full empty:hidden md:order-none md:-ms-8 md:flex-1">
              <Suspense fallback={null}>
                <HeaderSponsor />
              </Suspense>
            </div>
            {/* `ms-auto` keeps these pinned to the far edge on their own: the
                sponsor slot beside them is the only flex-grow child, so when it
                is absent or dismissed they would otherwise collapse back
                against the brand. */}
            <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
              <LanguageSwitcher variant="onLight" />
              <RecommendationsBell
                initialRecs={bellRecs}
                unreadCount={unreadCount}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex items-center gap-2 text-slate-700 hover:bg-slate-100"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-slate-200 text-sm text-slate-700">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden text-sm sm:inline">
                      {user.name ?? user.email}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px]">
                  <SwitchAccountMenu
                    linkedAccounts={
                      user.linkedAccounts as Parameters<
                        typeof SwitchAccountMenu
                      >[0]["linkedAccounts"]
                    }
                    originator={
                      user.originator as Parameters<
                        typeof SwitchAccountMenu
                      >[0]["originator"]
                    }
                    originatorLocked={user.originatorLocked}
                  />
                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link
                      href="/learn"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {labels.tutorials}
                    </Link>
                  </DropdownMenuItem>
                  <SignOutMenuItem />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {!isEmailVerified && userEmail && (
            <UnverifiedEmailBanner email={userEmail} />
          )}

          <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </main>
        </div>
      </div>

      <MobileBottomNav
        labels={labels}
        sections={sections}
        mobilePrimary={mobilePrimary}
      />
    </div>
  );
}

function SidebarNavLink({
  item,
  siblingHrefs,
  nested = false,
}: {
  item: ShellNavItem;
  siblingHrefs: readonly string[];
  /**
   * Rows inside a collapsible section. They sit against a vertical rail and
   * are deliberately quieter than the section headers above them — same size
   * and weight at both levels is what made the tree read as one flat list.
   */
  nested?: boolean;
}) {
  const Icon = item.icon;
  const badge =
    item.badge !== undefined && item.badge > 0 ? (
      <span className="ms-auto min-w-[1.25rem] shrink-0 rounded-full bg-amber-500 px-1.5 text-center text-[10px] font-semibold text-white tabular-nums">
        {item.badge > 99 ? "99+" : item.badge}
      </span>
    ) : null;

  if (item.primary) {
    return (
      <NavLink
        href={item.href}
        siblingHrefs={siblingHrefs}
        highlightKey={`nav-${item.key}`}
        className="group relative my-1 flex items-center gap-3 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        activeClassName="ring-2 ring-primary/30"
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badge}
      </NavLink>
    );
  }
  return (
    <NavLink
      href={item.href}
      siblingHrefs={siblingHrefs}
      highlightKey={`nav-${item.key}`}
      exact={item.href === "/"}
      className={
        nested
          ? "group relative flex items-center gap-2.5 rounded-lg py-1.5 pe-3 ps-2.5 text-[13px] font-normal text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900"
          : "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-100 hover:text-slate-900"
      }
      activeClassName="bg-violet-50 text-violet-900 hover:bg-violet-50 hover:text-violet-900 shadow-sm shadow-violet-600/5"
    >
      <Icon
        className={`shrink-0 transition-colors group-data-[active=true]:text-violet-600 ${
          nested
            ? "h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600"
            : "h-4 w-4 text-slate-500 group-hover:text-slate-700"
        }`}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge}
    </NavLink>
  );
}

function MobileSectionList({ sections }: { sections: ShellNavSection[] }) {
  const siblingHrefs = sections.flatMap((s) => s.items).map((i) => i.href);

  return (
    <nav className="space-y-5">
      {sections.map((section, index) => (
        <div key={section.sectionKey ?? `${section.heading}-${index}`} className="space-y-0.5">
          {section.heading ? (
            <div className="ps-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {section.heading}
            </div>
          ) : null}
          {section.items.map((item) => {
            const Icon = item.icon;
            const badge =
              item.badge !== undefined && item.badge > 0 ? (
                <span className="ms-auto min-w-[1.25rem] rounded-full bg-amber-500 px-1.5 text-center text-[10px] font-semibold text-white tabular-nums">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null;
            return (
              <NavLink
                key={item.key}
                href={item.href}
                siblingHrefs={siblingHrefs}
                highlightKey={`nav-${item.key}`}
                exact={item.href === "/"}
                className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                activeClassName="bg-violet-50 text-violet-900 hover:bg-violet-50 hover:text-violet-900"
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-500 group-data-[active=true]:text-violet-600" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {badge}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function MobileBottomNav({
  labels,
  sections,
  mobilePrimary,
}: {
  labels: AppShellLabels;
  sections: ShellNavSection[];
  mobilePrimary: Array<{ href: string; icon: Icon; label: string; exact?: boolean }>;
}) {
  const allItems = sections.flatMap((s) => s.items);
  const siblingHrefs = allItems.map((i) => i.href);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch justify-around border-t border-slate-200/80 bg-white/95 backdrop-blur md:hidden">
      {mobilePrimary.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.href}
            href={item.href}
            siblingHrefs={[...siblingHrefs, ...mobilePrimary.map((p) => p.href)]}
            exact={item.exact ?? false}
            highlightKey={
              item.href === "/outbound/new"
                ? "nav-new-document"
                : item.href === "/invoices/upload"
                  ? "nav-new-upload"
                  : item.href === "/"
                    ? "nav-home"
                    : undefined
            }
            className="group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-900"
            activeClassName="text-violet-600"
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="line-clamp-2 w-full text-center leading-tight">{item.label}</span>
          </NavLink>
        );
      })}
      <MobileNavDrawer title={labels.brand} side="end" variant="tab">
        <MobileSectionList sections={sections} />
      </MobileNavDrawer>
    </nav>
  );
}

