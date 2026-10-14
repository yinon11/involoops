import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = {
  title: "Welcome to Involoops",
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/welcome");
  }

  const row = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: {
      name: true,
      onboardingCompleted: true,
      onboardingStep: true,
      businessType: true,
    },
  });

  if (row?.onboardingCompleted) {
    redirect("/");
  }

  const businessType =
    row?.businessType === "freelancer" || row?.businessType === "small_business"
      ? row.businessType
      : null;

  return (
    <OnboardingWizard
      initialName={row?.name ?? session.user.name ?? ""}
      initialBusinessType={businessType}
      initialStep={row?.onboardingStep ?? 0}
    />
  );
}
