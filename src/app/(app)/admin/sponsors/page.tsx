import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { areSponsorsEnabled } from "@/lib/sponsors/enabled";
import { SponsorsAdminClient } from "@/components/admin/sponsors/sponsors-admin-client";
import {
  getSponsorCampaigns,
  getSponsorLeads,
} from "@/actions/sponsor-admin-actions";

export const metadata = {
  title: "Sponsors",
  robots: { index: false, follow: false },
};

export default async function AdminSponsorsPage() {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const [campaigns, leads] = await Promise.all([
    getSponsorCampaigns(),
    getSponsorLeads(),
  ]);

  return (
    <SponsorsAdminClient
      campaigns={campaigns}
      leads={leads}
      sponsorsEnabled={areSponsorsEnabled()}
    />
  );
}
