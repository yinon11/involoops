import { Suspense } from "react";
import { DashboardClient } from "@/features/expenses/components/dashboard/dashboard-client";
import {
  getDashboardData,
  type DashboardClientFilters,
} from "@/features/expenses/actions/invoice-actions";
import {
  getVendorTrackingData,
  updateVendorWebsiteUrl,
} from "@/features/expenses/actions/vendor-actions";
import { getCurrentPlan, getAvailablePlans } from "@/actions/subscription-actions";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VendorTrackingClient } from "@/features/expenses/components/dashboard/vendor-tracking-client";
import { getDictionary } from "@/lib/i18n/server";
import { ensureCapOrNotFound } from "@/lib/team/enforce";

export const metadata = {
  title: "Money Out",
  robots: { index: false, follow: false },
};

const defaultFilters: DashboardClientFilters = {
  vendorIds: [],
  timeRange: "last12Months",
  year: null,
  months: [],
  dateFrom: null,
  dateTo: null,
  showWithoutVat: false,
};

export default async function MoneyOutPage() {
  await ensureCapOrNotFound("view_reports");
  const session = await auth();
  const userId = session?.user?.id;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultVendorTrackingMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const [dashboardData, plan, availablePlans, vendorTrackingData, dict, userRow] =
    await Promise.all([
      getDashboardData(defaultFilters),
      getCurrentPlan(),
      getAvailablePlans(),
      getVendorTrackingData(defaultVendorTrackingMonth),
      getDictionary(),
      userId
        ? db
            .select({ name: users.name, companyName: users.companyName })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

  const defaultPlan = {
    tierName: "Free",
    tierCode: "free",
    maxInvoices: 10,
    priceMonthly: "0",
    status: "free",
    currentUsage: 0,
    yearMonth: currentMonth,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    byok: false,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {dict.dashboard.page.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {dict.dashboard.page.subtitle}
        </p>
      </header>

      <Suspense>
        <Tabs defaultValue="dashboard" className="w-full">
          <div className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
            <TabsList>
              <TabsTrigger value="dashboard">{dict.dashboard.tabs.dashboard}</TabsTrigger>
              <TabsTrigger value="vendor-tracking">{dict.dashboard.tabs.vendorTracking}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="dashboard">
            <DashboardClient
              initialData={dashboardData}
              fetchDashboardData={getDashboardData}
              plan={plan ?? defaultPlan}
              availablePlans={availablePlans}
              defaultSubscriberName={session?.user?.name ?? userRow?.name ?? ""}
              defaultBusinessLegalName={userRow?.companyName ?? ""}
            />
          </TabsContent>

          <TabsContent value="vendor-tracking">
            <VendorTrackingClient
              initialData={vendorTrackingData}
              initialMonth={defaultVendorTrackingMonth}
              fetchData={getVendorTrackingData}
              saveWebsiteUrl={updateVendorWebsiteUrl}
            />
          </TabsContent>
        </Tabs>
      </Suspense>
    </div>
  );
}
