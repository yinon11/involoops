import { redirect } from "next/navigation";

/**
 * Alias for the expenses overview.
 *
 * This page rendered its own copy of `DashboardClient` + `VendorTrackingClient`
 * — the same two components `/money-out` renders — so the two drifted
 * independently and a fix to one silently missed the other. `/money-out` is
 * the one in the nav, so it is the one that exists.
 */
export default function DashboardAliasPage() {
  redirect("/money-out");
}
