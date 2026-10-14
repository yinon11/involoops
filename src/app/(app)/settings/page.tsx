import { auth } from "@/auth";
import { db } from "@/db";
import { accountLinks, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getVendors, getGlobalExtractionRules } from "@/features/expenses/actions/vendor-actions";
import { getCurrentPlan, getAvailablePlans } from "@/actions/subscription-actions";
import { getUserApiKeyStatusAction } from "@/actions/user-api-key-actions";
import { getAccountPasswordFlags } from "@/actions/account-password-actions";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { AccountCard } from "@/components/settings/account-card";
import { SettingsClient } from "@/components/settings/settings-client";
import { PlanUsageCard } from "@/components/settings/plan-usage-card";
import { ApiKeyCard } from "@/components/settings/api-key-card";
import { AccountPasswordCard } from "@/components/settings/account-password-card";
import { DangerZoneCard } from "@/components/settings/danger-zone-card";
import { SponsoredOffersCard } from "@/components/settings/sponsored-offers-card";
import { MfaCard } from "@/components/settings/mfa-card";
import { DeviceSessionsCard } from "@/components/settings/device-sessions-card";
import { getMfaStatus } from "@/actions/mfa-actions";
import { listDeviceSessions } from "@/actions/device-session-actions";
import { InvoiceAliasCard } from "@/components/settings/invoice-alias-card";
import { AuthorizedSendersCard } from "@/components/settings/authorized-senders-card";
import { listAuthorizedSendersAction } from "@/features/expenses/actions/authorized-sender-actions";
import { getDeletionStatus } from "@/actions/gdpr-actions";
import { resolveDisplayCurrency } from "@/lib/fx";
import { TeamCard } from "@/components/settings/team-card";
import { listTeamMembers } from "@/lib/team/server";
import { listOwnerInvitations } from "@/actions/team-invitation-actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabFromQuery } = await searchParams;
  const session = await auth();
  const userId = session?.user?.id;

  const [
    vendors,
    globalExtractionRules,
    plan,
    availablePlans,
    userRow,
    apiKeyStatus,
    accountPasswordFlags,
  ] = await Promise.all([
    getVendors().catch(() => []),
    getGlobalExtractionRules().catch(() => []),
    getCurrentPlan(),
    getAvailablePlans(),
    userId
      ? db
          .select({
            displayCurrency: users.displayCurrency,
            invoiceAlias: users.invoiceAlias,
            suppressAutoApprovePrompt: users.suppressAutoApprovePrompt,
            sponsorTargetingOptOut: users.sponsorTargetingOptOut,
            autoActAsManagedAccounts: users.autoActAsManagedAccounts,
            name: users.name,
            companyName: users.companyName,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    getUserApiKeyStatusAction(),
    getAccountPasswordFlags(),
  ]);

  const [teamMembers, teamInvitations, managedAccountsCount, authorizedSenders] =
    await Promise.all([
    userId ? listTeamMembers(userId) : Promise.resolve([]),
    userId ? listOwnerInvitations(userId) : Promise.resolve([]),
    userId
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(accountLinks)
          .where(eq(accountLinks.managerUserId, userId))
          .then((rows) => rows[0]?.n ?? 0)
      : Promise.resolve(0),
    userId ? listAuthorizedSendersAction().catch(() => []) : Promise.resolve([]),
  ]);
  const hasManagedAccounts = managedAccountsCount > 0;

  const deletionStatus = await getDeletionStatus();
  const mfaStatus = userId
    ? await getMfaStatus().catch(() => ({
        enabled: false,
        backupCodesRemaining: 0,
        enabledAt: null,
      }))
    : { enabled: false, backupCodesRemaining: 0, enabledAt: null };
  const deviceSessions = userId
    ? await listDeviceSessions().catch(() => [])
    : [];

  // The business entity, template and API keys used to be fetched here for
  // tabs that duplicated their own pages. Those tabs are gone, and so are four
  // queries (one of them resolving a logo from storage) that ran on every
  // Settings load without anything rendering their results.

  const storedDisplayCurrency = userRow?.displayCurrency ?? null;
  const resolvedDisplayCurrency = resolveDisplayCurrency(storedDisplayCurrency);

  const allVendors = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    isIncomeSource: v.isIncomeSource ?? false,
    invoiceCount: v.invoiceCount,
  }));

  const defaultPlan = {
    tierName: "Free",
    tierCode: "free",
    maxInvoices: 10,
    priceMonthly: "0",
    status: "free",
    currentUsage: 0,
    yearMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    byok: false,
  };

  return (
    <SettingsTabs
      initialTab={tabFromQuery}
      generalTab={
        <AccountCard
          user={{
            name: session?.user?.name ?? "",
            email: session?.user?.email ?? "",
            companyName: userRow?.companyName ?? null,
            displayCurrency: storedDisplayCurrency,
            resolvedDisplayCurrency,
            autoActAsManagedAccounts:
              userRow?.autoActAsManagedAccounts ?? true,
            hasManagedAccounts,
          }}
        />
      }
      invoicesTab={
        <>
          <SettingsClient
            allVendors={allVendors}
            globalExtractionRules={globalExtractionRules.map((r) => ({
              id: r.id,
              vendorId: r.vendorId,
              name: r.name,
              priority: r.priority,
              rules: (r.rules ?? {}) as Record<string, unknown>,
              isActive: r.isActive,
            }))}
            suppressAutoApprovePrompt={
              userRow?.suppressAutoApprovePrompt ?? false
            }
          />
        </>
      }
      securityTab={
        accountPasswordFlags ? (
          <>
            <AccountPasswordCard
              hasGoogleLinked={accountPasswordFlags.hasGoogleLinked}
              hasPassword={accountPasswordFlags.hasPassword}
            />
            <MfaCard initialStatus={mfaStatus} />
            <DeviceSessionsCard initialSessions={deviceSessions} />
            <DangerZoneCard
              hasPassword={accountPasswordFlags.hasPassword}
              initialStatus={deletionStatus}
            />
          </>
        ) : (
          <>
            <MfaCard initialStatus={mfaStatus} />
            <DeviceSessionsCard initialSessions={deviceSessions} />
            <DangerZoneCard
              hasPassword={false}
              initialStatus={deletionStatus}
            />
          </>
        )
      }
      billingTab={
        <>
          <PlanUsageCard
            plan={plan ?? defaultPlan}
            availablePlans={availablePlans}
            defaultSubscriberName={session?.user?.name ?? userRow?.name ?? ""}
            defaultBusinessLegalName={userRow?.companyName ?? ""}
          />
          <ApiKeyCard initialStatus={apiKeyStatus} />
          <InvoiceAliasCard initialAlias={userRow?.invoiceAlias ?? null} />
          <AuthorizedSendersCard initialSenders={authorizedSenders} />
        </>
      }
      teamTab={
        <TeamCard
          members={teamMembers.map((m) => ({
            linkId: m.linkId,
            memberUserId: m.memberUserId,
            memberEmail: m.memberEmail,
            memberName: m.memberName,
            capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
            autoActAs: m.autoActAs,
          }))}
          invitations={teamInvitations.map((inv) => ({
            id: inv.id,
            email: inv.email,
            capabilities: Array.isArray(inv.capabilities)
              ? inv.capabilities
              : [],
            expiresAt: inv.expiresAt.toISOString(),
            acceptedAt: inv.acceptedAt?.toISOString() ?? null,
            revokedAt: inv.revokedAt?.toISOString() ?? null,
            createdAt: inv.createdAt.toISOString(),
          }))}
        />
      }
      dataTab={
        <div className="space-y-6">
          <SponsoredOffersCard
            initialOptOut={userRow?.sponsorTargetingOptOut ?? false}
            canChange={!session?.user?.originator}
          />
          {accountPasswordFlags ? (
            <DangerZoneCard
              hasPassword={accountPasswordFlags.hasPassword}
              initialStatus={deletionStatus}
            />
          ) : (
            <DangerZoneCard hasPassword={false} initialStatus={deletionStatus} />
          )}
        </div>
      }
    />
  );
}
