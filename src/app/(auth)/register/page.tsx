import type { Metadata } from "next";
import { redirectIfSessionExistsFromAuthEntryPage } from "@/lib/auth-entry-redirect";
import { RegisterForm } from "./register-form";
import { buildMetadata } from "@/lib/seo/metadata";

// Same rationale as /login — funnel UI, no informational content. The
// marketing home page (/) owns the "sign up for InvoLoops" intent.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/register",
    noindex: true,
    localized: false,
    copy: {
      en: {
        title: "Create your account",
        description:
          "Sign up for InvoLoops. Start automating invoice processing with AI-powered data extraction and real-time expense analytics.",
      },
      he: {
        title: "צרו חשבון",
        description:
          "הירשמו ל־InvoLoops. התחילו לבצע אוטומציה של עיבוד חשבוניות עם חילוץ נתונים מבוסס־AI ואנליטיקת הוצאות בזמן אמת.",
      },
    },
  });
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; email?: string }>;
}) {
  await redirectIfSessionExistsFromAuthEntryPage();
  const sp = await searchParams;
  const callbackUrl =
    typeof sp.callbackUrl === "string" && sp.callbackUrl.startsWith("/")
      ? sp.callbackUrl
      : undefined;
  const presetEmail =
    typeof sp.email === "string" && sp.email.length > 0 ? sp.email : undefined;
  return <RegisterForm callbackUrl={callbackUrl} presetEmail={presetEmail} />;
}
