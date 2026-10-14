import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { MarketingHeader } from "@/components/shared/marketing-header";
import { landingCopy } from "@/app/[locale]/_landing/copy";
import { buildMetadata, localePath } from "@/lib/seo/metadata";

const CERTIFICATE_HREF = "/certificates/involoops-ita-registration.pdf";

const copy = {
  en: {
    title: "License",
    description:
      "InvoLoops is registered with the Israel Tax Authority as software for a computerized accounting system. Certificate 281501 is valid from 15 September 2026 until 30 September 2028.",
    eyebrow: "Israel Tax Authority",
    heading: "Registered to keep books and issue invoices",
    intro:
      "The Israel Tax Authority has registered InvoLoops, edition 1, as software for managing a computerized accounting system. TTP GO LTD holds that registration, and businesses use InvoLoops under it to keep their books and issue invoices.",
    basis:
      "The registration is under Appendix ה׳ of section 36 of the Income Tax (Bookkeeping) Regulations, 5733–1973. The certificate is תעודת רישום number 281501, issued to טיטיפי גו בע״מ (TTP GO LTD).",
    detailsTitle: "What the certificate says",
    fields: [
      { label: "Authority", value: "Israel Tax Authority — Assessment and Audit Division, Computerized Audit Department" },
      { label: "Certificate number", value: "281501" },
      { label: "File number", value: "517193777" },
      { label: "Software", value: "InvoLoops (אינבולופס), edition 1" },
      { label: "Registered holder", value: "TTP GO LTD (טיטיפי גו בע״מ)" },
      { label: "Address on the certificate", value: "Shaharit 6/2, Herzliya" },
      { label: "Reference printed on the letter", value: "0046378" },
      { label: "Letter date", value: "12 October 2026 (1 Cheshvan 5787)" },
      { label: "Signed by", value: "Ruby Butbul (רובי בוטבול), Senior Deputy Director of Assessment and Audit (acting)" },
    ],
    validityTitle: "Validity",
    validFromLabel: "Valid from",
    validFrom: "15 September 2026",
    expiresLabel: "Expires",
    expires: "30 September 2028",
    noteTitle: "Limit stated on the certificate",
    note: "Registration does not confirm that the software performs correctly, or that it is suitable for keeping books of account. That limitation is printed on the certificate itself.",
    viewCertificate: "View the certificate",
    viewHint: "Opens the original Hebrew certificate (PDF).",
    backHome: "Back to the home page",
  },
  he: {
    title: "רישיון",
    description:
      "InvoLoops רשומה ברשות המסים בישראל כתוכנה לניהול מערכת חשבונות ממוחשבת. תעודת רישום 281501 בתוקף מ־15 בספטמבר 2026 עד 30 בספטמבר 2028.",
    eyebrow: "רשות המסים בישראל",
    heading: "רישום לניהול ספרים ולהפקת חשבוניות",
    intro:
      "רשות המסים בישראל רשמה את InvoLoops, מהדורה 1, כתוכנה לניהול מערכת חשבונות ממוחשבת. הרישום ניתן ל־TTP GO LTD, ועסקים משתמשים ב־InvoLoops מכוחו כדי לנהל ספרים ולהפיק חשבוניות.",
    basis:
      "הרישום נעשה לפי נספח ה׳ שבסעיף 36 להוראות מס הכנסה (ניהול פנקסי חשבונות), התשל״ג–1973. זו תעודת רישום מספר 281501, על שם טיטיפי גו בע״מ (TTP GO LTD).",
    detailsTitle: "הפרטים שעל התעודה",
    fields: [
      { label: "הרשות", value: "רשות המסים בישראל — חטיבת שומה וביקורת, מחלקת ביקורת ממוחשבת" },
      { label: "מספר תעודת רישום", value: "281501" },
      { label: "מספר תיק", value: "517193777" },
      { label: "התוכנה", value: "InvoLoops (אינבולופס), מהדורה 1" },
      { label: "בעל הרישום", value: "טיטיפי גו בע״מ (TTP GO LTD)" },
      { label: "הכתובת שעל התעודה", value: "שחרית 6/2, הרצליה" },
      { label: "מספר שמודפס על המכתב", value: "0046378" },
      { label: "תאריך המכתב", value: "12 באוקטובר 2026 (א׳ בחשוון תשפ״ז)" },
      { label: "חתימה", value: "רובי בוטבול, סמנכ״ל בכיר שומה וביקורת (בפועל)" },
    ],
    validityTitle: "תוקף",
    validFromLabel: "בתוקף מיום",
    validFrom: "15 בספטמבר 2026",
    expiresLabel: "עד",
    expires: "30 בספטמבר 2028",
    noteTitle: "הגבלה שכתובה על התעודה",
    note: "אין ברישום התוכנה כדי לאשר את נכונות ביצועיה או את התאמתה לניהול פנקסי חשבונות. כך כתוב על התעודה עצמה.",
    viewCertificate: "לצפייה בתעודה",
    viewHint: "נפתח המסמך המקורי בעברית (PDF).",
    backHome: "חזרה לדף הבית",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/license",
    copy: {
      en: { title: copy.en.title, description: copy.en.description },
      he: { title: copy.he.title, description: copy.he.description },
    },
  });
}

export default async function LicensePage() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = copy[locale];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <MarketingHeader
        locale={locale}
        appName={dict.common.appName}
        navLabel={dict.common.mainNavLabel}
        nav={landingCopy[locale].nav}
      />

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pb-24 sm:pt-10">
        <p className="text-sm font-semibold text-primary">{t.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t.heading}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t.intro}
        </p>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {t.basis}
        </p>

        <section
          aria-labelledby="license-validity"
          className="mt-8 grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:grid-cols-2"
        >
          <h2 id="license-validity" className="sr-only">
            {t.validityTitle}
          </h2>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              {t.validFromLabel}
            </p>
            <p className="mt-1 text-lg font-semibold text-emerald-950">{t.validFrom}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              {t.expiresLabel}
            </p>
            <p className="mt-1 text-lg font-semibold text-emerald-950">{t.expires}</p>
          </div>
        </section>

        <section aria-labelledby="license-details" className="mt-10">
          <h2 id="license-details" className="text-xl font-semibold text-foreground">
            {t.detailsTitle}
          </h2>
          <dl className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
            {t.fields.map((field) => (
              <div key={field.label} className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-muted-foreground">{field.label}</dt>
                <dd className="text-sm text-foreground sm:col-span-2">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="license-note" className="mt-8">
          <h2 id="license-note" className="text-xl font-semibold text-foreground">
            {t.noteTitle}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t.note}</p>
        </section>

        <div className="mt-8 flex flex-col items-start gap-2">
          <a
            href={CERTIFICATE_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            {t.viewCertificate}
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <p className="text-xs text-muted-foreground">{t.viewHint}</p>
        </div>

        <p className="mt-10">
          <Link
            href={localePath("/", locale)}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            {t.backHome}
          </Link>
        </p>
      </main>
    </div>
  );
}
