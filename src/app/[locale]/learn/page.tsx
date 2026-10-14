import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { format, localeConfig } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { tutorials, getTutorialProduct } from "./tutorials";
import { buildMetadata, getSiteUrl, localePath } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/learn",
    copy: {
      en: {
        title: "Learn — Tutorials & guides",
        description:
          "Practical guides for InvoLoops Insights and Studio. Learn how to upload invoices, manage vendors, issue invoices to your customers, and more — in a few minutes per topic.",
      },
      he: {
        title: "מרכז הלמידה — מדריכים",
        description:
          "מדריכים מעשיים ל־InvoLoops Insights ו־Studio. למדו איך להעלות חשבוניות, לנהל ספקים, להפיק חשבוניות ללקוחות שלכם ועוד — כמה דקות לכל נושא.",
      },
    },
  });
}

export const revalidate = 3600;

export default async function LearnIndexPage() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = dict.tutorials;
  const siteUrl = getSiteUrl();
  const cfg = localeConfig[locale];

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${locale}` },
      {
        "@type": "ListItem",
        position: 2,
        name: locale === "he" ? "מרכז הלמידה" : "Learn",
        item: `${siteUrl}/${locale}/learn`,
      },
    ],
  };

  const safeJson = (obj: unknown) =>
    JSON.stringify(obj)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(breadcrumbJsonLd) }}
      />

      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-5 sm:px-6 lg:px-10">
        <Link
          href={localePath("/", locale)}
          className="flex min-w-0 items-center gap-2"
          aria-label={dict.common.appName}
        >
          <Image
            src="/brand/involoops-mark-violet.svg"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 flex-shrink-0 sm:hidden"
            priority
          />
          <Image
            src="/brand/involoops-lockup-horizontal.svg"
            alt={dict.common.appName}
            width={520}
            height={130}
            className="hidden h-9 w-auto sm:block"
            priority
          />
        </Link>
        <nav
          aria-label={dict.common.mainNavLabel}
          className="flex flex-shrink-0 items-center gap-1 sm:gap-3"
        >
          <LanguageSwitcher variant="onLight" />
          <Link
            href="/register"
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 sm:px-5"
          >
            {locale === "he" ? "הצטרפו בחינם" : "Join free"}
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-12 lg:px-10">
        <div className="mb-10">
          <h1
            className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
            dir={cfg.dir}
            data-highlight="learn-title"
          >
            {t.title}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t.subtitle}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {locale === "he" ? (
              <>
                המדריך המלא (באנגלית) נמצא ב־{" "}
                <Link href="/developers/guide" className="font-medium text-primary underline">
                  מדריך המשתמש
                </Link>
                . תיעוד ה־API נמצא ב־{" "}
                <Link href="/developers" className="font-medium text-primary underline">
                  מסמכי המפתחים
                </Link>
                .
              </>
            ) : (
              <>
                The full product guide is the{" "}
                <Link href="/developers/guide" className="font-medium text-primary underline">
                  user guide
                </Link>
                . The API is documented on{" "}
                <Link href="/developers" className="font-medium text-primary underline">
                  the developer docs
                </Link>
                , not copied here.
              </>
            )}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {tutorials.map(({ slug, key }) => {
            const item = t.items[key];
            const product = getTutorialProduct(slug);
            const productLabel =
              product === "studio"
                ? locale === "he"
                  ? "Studio"
                  : "Studio"
                : locale === "he"
                  ? "Insights"
                  : "Insights";
            return (
              <Link
                key={slug}
                href={localePath(`/learn/${slug}`, locale)}
                data-highlight={`learn-${slug}`}
                className="group rounded-xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md sm:p-6"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      product === "studio"
                        ? "bg-teal-500/10 text-teal-700"
                        : "bg-violet-500/10 text-violet-700"
                    }`}
                  >
                    {productLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(t.minutes, { count: item.minutes })}
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-semibold text-foreground group-hover:text-primary">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.summary}
                </p>
                <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary transition group-hover:gap-2">
                  {t.readMore}
                  <span aria-hidden="true" className="rtl:rotate-180">
                    →
                  </span>
                </p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
