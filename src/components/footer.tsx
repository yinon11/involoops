import Link from "next/link";
import { getLocale } from "@/lib/i18n/server";
import { localePath } from "@/lib/seo/metadata";

// Hand-localised footer copy. Kept inline rather than threaded through the
// shared dictionary because the footer is the only consumer; promote later
// if any of these strings end up reused in headers / nav.
const FOOTER_COPY = {
  en: {
    products: "Products",
    insights: "Insights — Expense management",
    studio: "Studio — Invoice generator",
    company: "Company",
    contact: "Contact",
    developers: "Developers",
    userGuide: "User guide",
    learn: "Learn",
    legal: "Legal",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    accessibility: "Accessibility",
    license: "License",
    rights: "All rights reserved.",
  },
  he: {
    products: "מוצרים",
    insights: "Insights — ניהול הוצאות",
    studio: "Studio — מחולל חשבוניות",
    company: "החברה",
    contact: "צור קשר",
    developers: "Developers",
    userGuide: "מדריך למשתמש",
    learn: "מרכז הלמידה",
    legal: "מידע משפטי",
    privacy: "מדיניות פרטיות",
    terms: "תנאי שימוש",
    accessibility: "נגישות",
    license: "רישיון",
    rights: "כל הזכויות שמורות.",
  },
} as const;

export async function Footer() {
  const locale = await getLocale();
  const t = FOOTER_COPY[locale];

  return (
    <footer className="mt-auto border-t border-gray-200 bg-white/60 text-sm text-gray-600">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-900">
            {t.products}
          </h2>
          <ul className="space-y-2">
            <li>
              <Link
                href={`${localePath("/", locale)}#insights`}
                className="hover:text-gray-900 hover:underline"
              >
                {t.insights}
              </Link>
            </li>
            <li>
              <Link
                href={`${localePath("/", locale)}#studio`}
                className="hover:text-gray-900 hover:underline"
              >
                {t.studio}
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-900">
            {t.company}
          </h2>
          <ul className="space-y-2">
            <li>
              <Link href={localePath("/contact", locale)} className="hover:text-gray-900 hover:underline">
                {t.contact}
              </Link>
            </li>
            <li>
              <Link href={localePath("/learn", locale)} className="hover:text-gray-900 hover:underline">
                {t.learn}
              </Link>
            </li>
            <li>
              {/* /developers is intentionally English-only (see
                  developers/layout.tsx) — no locale prefix. The user guide
                  is the same site, rendered from docs/user-guide. */}
              <Link
                href="/developers/guide"
                className="hover:text-gray-900 hover:underline"
              >
                {t.userGuide}
              </Link>
            </li>
            <li>
              <Link
                href="/developers"
                className="hover:text-gray-900 hover:underline"
              >
                {t.developers}
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-3 sm:col-span-2 lg:col-span-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-900">
            {t.legal}
          </h2>
          <ul className="space-y-2">
            <li>
              <Link href={localePath("/privacy", locale)} className="hover:text-gray-900 hover:underline">
                {t.privacy}
              </Link>
            </li>
            <li>
              <Link href={localePath("/terms", locale)} className="hover:text-gray-900 hover:underline">
                {t.terms}
              </Link>
            </li>
            <li>
              <Link
                href={localePath("/accessibility", locale)}
                className="hover:text-gray-900 hover:underline"
              >
                {t.accessibility}
              </Link>
            </li>
            <li>
              <Link
                href={localePath("/license", locale)}
                className="hover:text-gray-900 hover:underline"
              >
                {t.license}
              </Link>
            </li>
          </ul>
        </div>

        {/* Brand / copyright column — visually balances the grid on lg+ and
            anchors the right edge with consistent spacing. */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-900">
            InvoLoops
          </h2>
          <p className="text-xs leading-relaxed text-gray-500">
            © {new Date().getFullYear()} TTP GO LTD. {t.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
