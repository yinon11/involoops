import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isUserAdmin } from "@/lib/is-user-admin";
import { getPendingInvoiceCount } from "@/features/expenses/actions/invoice-actions";
import { InvoiceUploadProvider } from "@/contexts/invoice-upload-context";
import { GlobalInvoiceDropLayer } from "@/features/expenses/components/invoices/global-invoice-drop-layer";
import { PendingCountProvider } from "@/contexts/pending-count-context";
import { AppShell } from "@/components/shell/app-shell";
import { AdminShell } from "@/components/shell/admin-shell";
import { getDictionary } from "@/lib/i18n/server";
import { readMode } from "@/lib/mode";
import { canAccessSettingsUi } from "@/lib/team/enforce";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/brand/involoops-favicon.svg", type: "image/svg+xml" }],
    shortcut: "/brand/involoops-favicon.svg",
  },
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user;
  console.log(`[app] render uid=${user.id ?? "?"}`);

  const [pendingCount, isAdmin, dict, userRow, mode] = await Promise.all([
    getPendingInvoiceCount(),
    isUserAdmin(user.id),
    getDictionary(),
    db.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: {
        emailVerified: true,
        email: true,
        onboardingCompleted: true,
      },
    }),
    readMode(),
  ]);

  const onboardingCompleted = userRow?.onboardingCompleted ?? false;

  const isEmailVerified = Boolean(userRow?.emailVerified);
  const initials = (user.name ?? user.email ?? "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const canManageSettingsNav =
    isAdmin ||
    canAccessSettingsUi(user.actingAsCapabilities, user.originator);

  const modeLabels = {
    expense: dict.shell.mode.expense,
    creator: dict.shell.mode.creator,
    admin: dict.shell.mode.admin,
    title: dict.shell.mode.title,
  };

  if (mode === "admin" && isAdmin) {
    return (
      <AdminShell
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          linkedAccounts: user.linkedAccounts,
          originator: user.originator,
          originatorLocked: user.originatorLocked,
        }}
        initials={initials}
        labels={{
          brand: dict.shell.admin.brand,
          slogan: dict.shell.admin.slogan,
          mode: modeLabels,
          nav: dict.shell.admin.nav,
          tutorials: dict.nav.tutorials,
        }}
      >
        {children}
      </AdminShell>
    );
  }

  if (!onboardingCompleted) {
    redirect("/welcome");
  }

  return (
    <PendingCountProvider initialCount={pendingCount}>
      <AppShell
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          linkedAccounts: user.linkedAccounts,
          originator: user.originator,
          originatorLocked: user.originatorLocked,
        }}
        canManageSettings={canManageSettingsNav}
        isEmailVerified={isEmailVerified}
        userEmail={userRow?.email ?? null}
        initials={initials}
        isAdmin={isAdmin}
        appMode={mode}
        pendingCount={pendingCount}
        modeSwitcherLabels={modeLabels}
        labels={{
          brand: dict.shell.app.brand,
          groupBusiness: dict.shell.app.groupBusiness,
          groupIncome: dict.shell.app.groupIncome,
          groupTaxes: dict.shell.app.groupTaxes,
          groupMore: dict.shell.app.groupMore,
          home: dict.shell.app.home,
          sendInvoice: dict.shell.app.sendInvoice,
          addExpense: dict.shell.app.addExpense,
          moneyIn: dict.shell.app.moneyIn,
          moneyOut: dict.shell.app.moneyOut,
          vatEstimates: dict.shell.app.vatEstimates,
          projects: dict.shell.app.projects,
          clients: dict.shell.app.clients,
          settings: dict.shell.app.settings,
          tutorials: dict.nav.tutorials,
          groupExpenses: dict.shell.app.groupExpenses,
          invoices: dict.nav.invoices,
          pending: dict.nav.pending,
          duplicates: dict.nav.duplicates,
          vendors: dict.nav.vendors,
          // Reuse the Studio nav strings the creator sidebar already had, so
          // unifying the tree does not invent a second set of translations.
          groupHelp: dict.shell.app.groupHelp,
          newMenu: dict.shell.app.newMenu,
          documents: dict.shell.app.documents,
          collections: dict.shell.creator.nav.collections,
          overview: dict.shell.creator.nav.home,
          uniformStructure: dict.shell.creator.nav.uniformStructure,
          hashavshevet: dict.shell.creator.nav.hashavshevet,
          itaIntegration: dict.shell.creator.nav.itaIntegration,
          itaGuide: dict.shell.creator.nav.tutorial,
          general: dict.shell.app.settings,
          businessDetails: dict.shell.creator.nav.businessDetails,
          template: dict.shell.creator.nav.template,
          apiKeys: dict.shell.creator.nav.apiKeys,
          developers: dict.shell.creator.nav.developers,
        }}
      >
        <InvoiceUploadProvider key={user.id} userId={user.id}>
          <GlobalInvoiceDropLayer />
          {children}
        </InvoiceUploadProvider>
      </AppShell>
    </PendingCountProvider>
  );
}
