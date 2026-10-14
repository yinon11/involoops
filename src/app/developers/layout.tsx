import { I18nProvider } from "@/lib/i18n/client";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DevsTopBar } from "./_components/top-bar";

/**
 * The /developers section is intentionally English-only and rendered
 * left-to-right regardless of the user's selected app locale. The REST
 * API, scopes, code samples, and webhook payload shapes are all in
 * English, so mixing them with an RTL/Hebrew chrome harms readability.
 *
 * We override the inherited `dir`/`lang` on a wrapper element (the root
 * `<html>` tag set by `app/layout.tsx` follows the user's locale, but
 * inner `dir`/`lang` attributes win for everything they contain) and
 * swap the i18n context to the English dictionary so any shared client
 * component rendered here reads English copy.
 */
export default function DevelopersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <I18nProvider locale="en" dict={dictionaries.en}>
      <div dir="ltr" lang="en" className="min-h-screen bg-white text-left text-slate-900">
        <DevsTopBar />
        {children}
      </div>
    </I18nProvider>
  );
}
