import type { Metadata } from "next";
import { redirectIfSessionExistsFromAuthEntryPage } from "@/lib/auth-entry-redirect";
import { LoginForm } from "./login-form";
import { buildMetadata } from "@/lib/seo/metadata";

// Auth pages shouldn't compete with the marketing pages in search — they're
// pure funnel UI with no informational content. `noindex` keeps them out of
// the SERP while still letting paid traffic / direct links resolve normally.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/login",
    noindex: true,
    localized: false,
    copy: {
      en: {
        title: "Log in",
        description:
          "Sign in to your InvoLoops account to manage invoices, track expenses, and view analytics.",
      },
      he: {
        title: "התחברות",
        description:
          "היכנסו לחשבון InvoLoops שלכם כדי לנהל חשבוניות, לעקוב אחרי הוצאות ולצפות באנליטיקה.",
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

export default async function LoginPage({
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
      resetOk={sp.reset === "1"}
      registered={sp.registered === "1"}
      verified={sp.verified === "1"}
      authError={authError}
      callbackUrl={callbackUrl}
      presetEmail={presetEmail}
    />
  );
}
