import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAccessSettingsUi } from "@/lib/team/enforce";

/**
 * Team members without `manage_settings` cannot open any `/settings/*` route.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const allowed =
    session.user.isAdmin === true ||
    canAccessSettingsUi(session.user.actingAsCapabilities, session.user.originator);
  if (!allowed) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
