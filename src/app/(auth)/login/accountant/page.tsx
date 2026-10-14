import type { Metadata } from "next";
import { redirectIfSessionExistsFromAuthEntryPage } from "@/lib/auth-entry-redirect";
import { LoginForm } from "../login-form";
import { buildMetadata } from "@/lib/seo/metadata";

// Accountant-branded entry point. Same noindex policy as the standard login —
// pure funnel UI with no informational content.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/login/accountant",
    noindex: true,
    localized: false,
    copy: {
      en: {
        title: "Accountant sign-in",
        description:
          "Sign in to InvoLoops Studio to manage your clients' invoicing.",
      },
      he: {
        title: "כניסת רואה חשבון",
        description:
          "התחברו ל-InvoLoops Studio כדי לנהל את החשבוניות של הלקוחות שלכם.",
      },
    },
  });
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "This email is already registered with a password. Sign in with email and password, or use a different Google account.",
  AccessDenied: "Access was denied. Try again or use another sign-in method.",
  Configuration: "Sign-in is temporarily unavailable. Please try again later.",
};

export default async function AccountantLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    reset?: string;
    registered?: string;
    verified?: string;
    error?: string;
    callbackUrl?: string;
    email?: string;
  }>;
}) {
  await redirectIfSessionExistsFromAuthEntryPage();
  const sp = await searchParams;
  const errorCode = typeof sp.error === "string" ? sp.error : undefined;
  const authError = errorCode
    ? (AUTH_ERROR_MESSAGES[errorCode] ??
      "Sign in failed. Try again or use another method.")
    : undefined;

  // Only relative paths — prevents open-redirect via crafted ?callbackUrl=https://attacker.
  const callbackUrl =
    typeof sp.callbackUrl === "string" && sp.callbackUrl.startsWith("/")
      ? sp.callbackUrl
      : undefined;
  const presetEmail =
    typeof sp.email === "string" && sp.email.length > 0 ? sp.email : undefined;

  return (
    <LoginForm
      accountant
      resetOk={sp.reset === "1"}
      registered={sp.registered === "1"}
      verified={sp.verified === "1"}
      authError={authError}
      callbackUrl={callbackUrl}
      presetEmail={presetEmail}
    />
  );
}
