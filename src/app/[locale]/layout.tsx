import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";

/**
 * Locale segment for public marketing routes (`/en/...`, `/he/...`).
 *
 * No HTML wrapper here — the root `app/layout.tsx` owns `<html>`, GTM, the
 * cookie consent shell, and the global footer. This layout's only job is to
 * 404 on bogus locale segments (`/foo/contact` etc.) before they reach a
 * page component. The active locale is resolved from the `x-locale` request
 * header set by `middleware.ts`, so `getLocale()` returns the URL-driven
 * locale automatically without page-level threading.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  return children;
}

// Statically render both supported locales so the marketing surface ships as
// pre-built HTML. Anything unknown falls through to dynamic + the 404 above.
export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "he" }];
}
