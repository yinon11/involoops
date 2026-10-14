import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { format, localeConfig } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { getTutorialBySlug, tutorials, getTutorialProduct } from "../tutorials";
import { buildMetadata, getSiteUrl, localePath } from "@/lib/seo/metadata";

interface Props {
  params: Promise<{ slug: string }>;
}

// 1h ISR — tutorials change rarely; this lets edits ship without forcing a
// full deploy/rebuild while still serving from cache.
export const revalidate = 3600;

export async function generateStaticParams() {
  return tutorials.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tutorial = getTutorialBySlug(slug);
  if (!tutorial) return { title: "Tutorial" };
  const dict = await getDictionary();
  const item = dict.tutorials.items[tutorial.key];

  return buildMetadata({
    path: `/learn/${slug}`,
    copy: {
      en: {
        title: `${item.title} — InvoLoops`,
        description: item.summary,
      },
      he: {
        title: `${item.title} — InvoLoops`,
        description: item.summary,
      },
    },
  });
}

export default async function LearnTutorialPage({ params }: Props) {
  const { slug } = await params;
  const tutorial = getTutorialBySlug(slug);
  if (!tutorial) {
    notFound();
  }

  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = dict.tutorials;
  const item = t.items[tutorial.key];
  const sections = Object.values(item.sections);
  const product = getTutorialProduct(slug);
  const siteUrl = getSiteUrl();
  const cfg = localeConfig[locale];

  // Article JSON-LD — surfaces in Google Discover and rich-result tutorials
  // section. `articleBody` concatenates section bodies so search engines see
  // the full text without parsing the rendered HTML.
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: item.title,
    description: item.summary,
    inLanguage: locale,
    author: { "@type": "Organization", name: "InvoLoops" },
    publisher: {
      "@type": "Organization",
      name: "InvoLoops",
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/opengraph-image`,
      },
    },
    mainEntityOfPage: `${siteUrl}/${locale}/learn/${slug}`,
    articleBody: sections.map((s) => s.body).join("\n\n"),
  };

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
      {
        "@type": "ListItem",
        position: 3,
        name: item.title,
        item: `${siteUrl}/${locale}/learn/${slug}`,
      },
    ],
  };

  const safeJson = (obj: unknown) =>
    JSON.stringify(obj)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");

  const productHref = `${localePath("/", locale)}#${product}`;
  const productCta =
    product === "studio"
      ? locale === "he"
        ? "גלו את InvoLoops Studio"
        : "Explore InvoLoops Studio"
      : locale === "he"
        ? "גלו את InvoLoops Insights"
        : "Explore InvoLoops Insights";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(articleJsonLd) }}
      />
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
            href={localePath("/learn", locale)}
            className="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-foreground/80 transition hover:bg-secondary hover:text-foreground sm:px-4"
          >
            {dict.home.nav.tutorials}
          </Link>
          <Link
            href="/register"
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 sm:px-5"
          >
            {locale === "he" ? "הצטרפו בחינם" : "Join free"}
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-4 sm:px-6 sm:pb-24 lg:px-10" dir={cfg.dir}>
        <nav className="mb-6 text-sm">
          <Link
            href={localePath("/learn", locale)}
            className="text-muted-foreground hover:text-foreground"
          >
            {locale === "he" ? "→" : "←"} {t.backToList}
          </Link>
        </nav>

        <article>
          <header className="mb-8 border-b border-border pb-6">
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                product === "studio"
                  ? "bg-teal-500/10 text-teal-700"
                  : "bg-violet-500/10 text-violet-700"
              }`}
            >
              {product === "studio" ? "Studio" : "Insights"}
            </span>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {item.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {format(t.minutes, { count: item.minutes })}
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {item.summary}
            </p>
          </header>

          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  {section.heading}
                </h2>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  {section.body}
                </p>
              </section>
            ))}
          </div>

          {/* Cross-link back to the relevant product page — closes the SEO
              loop so /learn/[slug] passes link equity to the product it
              actually belongs to. */}
          <div className="mt-12 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <p className="text-sm text-muted-foreground">
              {locale === "he"
                ? "מוכנים לראות את זה בפעולה?"
                : "Ready to see it in action?"}
            </p>
            <Link
              href={productHref}
              className="mt-2 inline-flex items-center gap-1.5 text-base font-semibold text-primary hover:gap-2"
            >
              {productCta}
              <span aria-hidden="true" className="rtl:rotate-180">
                →
              </span>
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
