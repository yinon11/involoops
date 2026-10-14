import Link from "next/link";
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
import { BrandProductSwitcher } from "@/components/shell/brand-product-switcher";
import { MobileNavDrawer } from "@/components/shell/mobile-nav-drawer";
import { NavLink } from "@/components/shell/nav-link";
import {
  LayoutDashboard,
  Users,
  FileClock,
  Archive,
  Plug,
  FileDown,
  Mails,
  Megaphone,
  CalendarClock,
  Send,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";

interface AdminShellProps {
  children: ReactNode;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    linkedAccounts?: unknown;
    originator?: unknown;
    originatorLocked?: boolean;
  };
  initials: string;
  labels: {
    brand: string;
    slogan: string;
    mode: {
      expense: string;
      creator: string;
      admin: string;
      title: string;
    };
    nav: {
      overview: string;
      users: string;
      emailFunnels: string;
      plannedEmails: string;
      sentEmails: string;
      audit: string;
      archive: string;
      shaam: string;
      uniformStructure: string;
      sponsors: string;
      privacyPopulation: string;
    };
    tutorials: string;
  };
}

const NAV_GROUPS = [
  {
    key: "overview",
    items: [{ key: "overview", href: "/admin", icon: LayoutDashboard }],
  },
  {
    key: "tenants",
    items: [{ key: "users", href: "/admin/users", icon: Users }],
  },
  {
    key: "email",
    items: [
      { key: "emailFunnels", href: "/admin/email-funnels", icon: Mails },
      {
        key: "plannedEmails",
        href: "/admin/planned-emails",
        icon: CalendarClock,
      },
      { key: "sentEmails", href: "/admin/sent-emails", icon: Send },
    ],
  },
  {
    key: "growth",
    items: [{ key: "sponsors", href: "/admin/sponsors", icon: Megaphone }],
  },
  {
    key: "compliance",
    items: [
      { key: "audit", href: "/admin/audit", icon: FileClock },
      { key: "archive", href: "/admin/archive", icon: Archive },
      {
        key: "privacyPopulation",
        href: "/admin/privacy-population",
        icon: UserCheck,
      },
      {
        key: "uniformStructure",
        href: "/admin/uniform-structure",
        icon: FileDown,
      },
    ],
  },
  {
    key: "integrations",
    items: [{ key: "shaam", href: "/admin/shaam", icon: Plug }],
  },
] as const;

const ADMIN_NAV_HREFS = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.href),
);

export function AdminShell({
  children,
  user,
  initials,
  labels,
}: AdminShellProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <DeletionBanner />

      <div className="mx-auto flex min-h-screen max-w-[1500px]">
        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-e border-zinc-800 bg-zinc-900 md:flex">
          <div className="border-b border-zinc-800 px-4 py-4">
            <BrandProductSwitcher
              currentMode="admin"
              isAdmin
              labels={labels.mode}
              variant="admin"
            />
            <p className="mt-1 truncate px-1 text-[11px] text-zinc-400">
              {labels.slogan}
            </p>
          </div>

          <nav className="flex-1 space-y-5 px-3 py-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.key} className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      siblingHrefs={ADMIN_NAV_HREFS}
                      highlightKey={`nav-${item.key}`}
                      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                      activeClassName="bg-zinc-800 text-white shadow-inner"
                    >
                      <Icon className="h-4 w-4 text-zinc-400 group-data-[active=true]:text-amber-400" />
                      {labels.nav[item.key]}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col bg-zinc-50 text-zinc-900">
          <header className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <MobileNavDrawer
                title={labels.brand}
                subtitle={labels.slogan}
                panelClassName="bg-zinc-900 text-zinc-100"
                triggerClassName="text-zinc-700 hover:bg-zinc-100"
              >
                <nav className="space-y-5">
                  {NAV_GROUPS.map((group) => (
                    <div key={group.key} className="space-y-1">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <NavLink
                            key={item.href}
                            href={item.href}
                            siblingHrefs={ADMIN_NAV_HREFS}
                            className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                            activeClassName="bg-zinc-800 text-white shadow-inner"
                          >
                            <Icon className="h-4 w-4 text-zinc-400 group-data-[active=true]:text-amber-400" />
                            {labels.nav[item.key]}
                          </NavLink>
                        );
                      })}
                    </div>
                  ))}
                </nav>
              </MobileNavDrawer>
              <div className="min-w-0 flex-1">
                <BrandProductSwitcher
                  currentMode="admin"
                  isAdmin
                  labels={labels.mode}
                  compact
                />
              </div>
            </div>
            <div className="ms-auto flex items-center gap-1 sm:gap-2">
              <LanguageSwitcher />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex items-center gap-2 text-zinc-700 hover:bg-zinc-100"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-zinc-200 text-sm text-zinc-700">
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
                      user.linkedAccounts as Parameters<typeof SwitchAccountMenu>[0]["linkedAccounts"]
                    }
                    originator={
                      user.originator as Parameters<typeof SwitchAccountMenu>[0]["originator"]
                    }
                    originatorLocked={user.originatorLocked}
                  />
                  <DropdownMenuItem asChild className="cursor-pointer">
                    {/* See `(app)/layout.tsx` for the rationale: tutorials
                        live as public pages under /[locale]/learn; the
                        bare /learn is 308-redirected by middleware. */}
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

          <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
