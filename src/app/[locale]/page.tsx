import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  Calculator,
  Check,
  CodeXml,
  Coins,
  Copy,
  FileMinus,
  Fingerprint,
  Hash,
  Inbox,
  KeyRound,
  ListChecks,
  Lock,
  Mail,
  MessageSquare,
  Palette,
  Plug,
  Scale,
  User,
  Users,
} from "lucide-react";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { localeConfig } from "@/lib/i18n";
import { MarketingHeader } from "@/components/shared/marketing-header";
import { localePath } from "@/lib/seo/metadata";
import { landingCopy, type LandingCopy } from "./_landing/copy";
import {
  ChatMockup,
  HeroMockup,
  ProfitMockup,
  SearchMockup,
  StudioMockup,
  VendorSpendMockup,
} from "./_landing/mockups";
import "@/components/teaser/teaser-aurora.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost:3000";

const GITHUB_URL = "https://github.com/yinon11/involoops";

/** Brand violet / teal / warm pink, driving the aurora and gradient text. */
const PALETTE = { a: "#7c3aed", b: "#14b8a6", c: "#f472b6" } as const;

const paletteStyle = {
  "--teaser-a": PALETTE.a,
  "--teaser-b": PALETTE.b,
  "--teaser-c": PALETTE.c,
} as React.CSSProperties;

const gradientText = {
  backgroundImage: `linear-gradient(90deg, ${PALETTE.a}, ${PALETTE.b}, ${PALETTE.c})`,
};

// Icons pair with copy arrays by index; both locales keep the same order.
const STUDIO_ICONS = [Hash, ArrowLeftRight, FileMinus, Palette, Mail, Fingerprint];
const INSIGHTS_MORE_ICONS = [Inbox, Copy, ListChecks, Users, Coins];
const AUDIENCE_ICONS = [User, Briefcase, Building2, Calculator];
const AI_STEP_ICONS = [Plug, KeyRound, MessageSquare];
const TRUST_ICONS = [Lock, CodeXml, Scale];

export async function generateMetadata(): Promise<Metadata> {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = landingCopy[locale];
  const tag = localeConfig[locale].tag;
  const canonical = `${siteUrl}/${locale}`;
  return {
    title: { absolute: t.meta.title },
    description: t.meta.description,
    alternates: {
      canonical,
      languages: {
        en: `${siteUrl}/en`,
        he: `${siteUrl}/he`,
        "x-default": `${siteUrl}/en`,
      },
    },
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      url: canonical,
      type: "website",
      locale: tag.replace("-", "_"),
      siteName: dict.common.appName,
    },
    twitter: {
      card: "summary_large_image",
      title: t.meta.title,
      description: t.meta.description,
    },
  };
}

// Site-wide JSON-LD graph. Lives only on the home page (Google treats the
// Organization + WebSite nodes as site-level when published from `/`). Node
// ids are locale-free so /en and /he describe the same entities; the WebPage
// and FAQPage nodes are per-locale because their text is.
function buildJsonLd(t: LandingCopy, locale: keyof typeof localeConfig) {
  const home = `${siteUrl}/${locale}`;
  const org = { "@id": `${siteUrl}/#organization` };
  const shareImage = `${home}/opengraph-image`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: "InvoLoops",
        legalName: "TTP GO LTD",
        url: siteUrl,
        // Square mark: Google's logo guidelines want a square-ish image of at
        // least 112px, not the 1200×630 share card.
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/brand/png/appicon-512.png`,
          width: 512,
          height: 512,
        },
        sameAs: [GITHUB_URL],
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: "support@involoops.com",
            areaServed: ["IL", "US", "EU"],
            availableLanguage: ["English", "Hebrew"],
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "InvoLoops",
        publisher: org,
        inLanguage: ["en", "he"],
      },
      {
        "@type": "WebPage",
        "@id": `${home}#webpage`,
        url: home,
        name: t.meta.title,
        description: t.meta.description,
        inLanguage: localeConfig[locale].tag,
        isPartOf: { "@id": `${siteUrl}/#website` },
        about: [{ "@id": `${siteUrl}/#studio` }, { "@id": `${siteUrl}/#insights` }],
        primaryImageOfPage: { "@type": "ImageObject", url: shareImage },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteUrl}/#studio`,
        name: "InvoLoops Studio",
        description: t.meta.appStudio,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: `${home}#studio`,
        image: shareImage,
        inLanguage: ["he", "en"],
        isAccessibleForFree: true,
        license: "https://www.gnu.org/licenses/agpl-3.0.html",
        featureList: [...t.studio.docTypes, ...t.studio.features.map((f) => f.title)],
        publisher: org,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "ILS",
        },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteUrl}/#insights`,
        name: "InvoLoops Insights",
        description: t.meta.appInsights,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: `${home}#insights`,
        image: shareImage,
        inLanguage: ["he", "en"],
        license: "https://www.gnu.org/licenses/agpl-3.0.html",
        featureList: [
          ...t.insights.highlights.map((h) => h.title),
          ...t.insights.more.map((m) => m.title),
        ],
        publisher: org,
        // Only the free tier is listed: an Offer without a price is flagged
        // by Google's rich-result validator, and the symbolic fee has none.
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "ILS",
          description: t.pricing.byok.note,
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${home}#faq`,
        inLanguage: localeConfig[locale].tag,
        mainEntity: t.faq.items.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

function SectionHeading({
  id,
  eyebrow,
  title,
  body,
  align = "start",
  onDark = false,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  body?: string;
  align?: "start" | "center";
  onDark?: boolean;
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow && (
        <p
          className={`text-sm font-semibold uppercase tracking-wider ${onDark ? "text-teal-300" : "text-primary"}`}
        >
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className={`mt-2 text-3xl font-bold tracking-tight sm:text-4xl ${onDark ? "text-white" : "text-foreground"}`}
      >
        {title}
      </h2>
      {body && (
        <p
          className={`mt-4 text-base leading-relaxed sm:text-lg ${onDark ? "text-white/75" : "text-muted-foreground"}`}
        >
          {body}
        </p>
      )}
    </div>
  );
}

const container = "mx-auto max-w-6xl px-4 sm:px-6 lg:px-10";

export default async function HomePage() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = landingCopy[locale];
  const insightMockups = {
    vendors: <VendorSpendMockup t={t} />,
    search: <SearchMockup t={t} />,
    profit: (
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <ProfitMockup t={t} />
      </div>
    ),
  } as const;

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json">
        {JSON.stringify(buildJsonLd(t, locale))
          .replace(/</g, "\\u003c")
          .replace(/>/g, "\\u003e")
          .replace(/&/g, "\\u0026")}
      </script>

      <MarketingHeader
        locale={locale}
        appName={dict.common.appName}
        navLabel={dict.common.mainNavLabel}
        nav={t.nav}
      />

      <main>
        {/* Hero ---------------------------------------------------------- */}
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden bg-slate-950 text-white"
          style={paletteStyle}
        >
          <div className="teaser-aurora" aria-hidden="true">
            <div className="teaser-blob" />
          </div>
          <div
            className={`${container} relative grid gap-12 py-16 sm:py-20 lg:grid-cols-12 lg:items-center lg:gap-14 lg:py-24`}
          >
            <div className="lg:col-span-6">
              <p
                data-highlight="hero-badge"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3.5 py-1.5 text-sm font-semibold text-emerald-200"
              >
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                {t.ita.badge}
              </p>
              <h1
                id="hero-heading"
                data-highlight="hero-title"
                className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl"
              >
                <span className="block">{t.hero.titleLead}</span>
                <span className="mt-1 block bg-clip-text text-transparent" style={gradientText}>
                  {t.hero.titleAccent}
                </span>
              </h1>
              <p
                data-highlight="hero-subtitle"
                className="mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg"
              >
                {t.hero.subtitle}
              </p>
              <div data-highlight="hero-cta" className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-7 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-white/90"
                >
                  {t.hero.primaryCta}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </Link>
                <a
                  href="#how"
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-white/30 px-7 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {t.hero.secondaryCta}
                </a>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70">
                {t.hero.micro.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-teal-300" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div data-highlight="hero-preview" className="lg:col-span-6">
              <HeroMockup t={t} />
            </div>
          </div>

          {/* Proof strip */}
          <div className="relative border-t border-white/10 bg-white/[0.03]">
            <ul
              className={`${container} flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-5 text-sm font-medium text-white/75`}
            >
              {[t.ita.proof, ...t.proof].map((item) => (
                <li key={item} className="inline-flex items-center gap-2">
                  <ShieldDot />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The loop: money in + money out = profit ---------------------- */}
        <section
          id="how"
          aria-labelledby="loop-heading"
          className={`${container} scroll-mt-20 py-20 sm:py-24`}
        >
          <SectionHeading
            id="loop-heading"
            title={t.loop.title}
            body={t.loop.subtitle}
            align="center"
          />
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {t.loop.items.map((item, idx) => (
              <li
                key={item.tag}
                className="relative rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: [PALETTE.b, PALETTE.a, PALETTE.c][idx] }}
                >
                  {["+", "−", "="][idx]}
                </span>
                <h3 className="mt-4 text-xl font-semibold text-foreground">{item.tag}</h3>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {item.product}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Studio -------------------------------------------------------- */}
        <section
          id="studio"
          aria-labelledby="studio-heading"
          data-highlight="studio"
          className="scroll-mt-20 border-y border-border bg-gradient-to-b from-teal-50/60 to-background py-20 sm:py-24"
        >
          <div className={container}>
            <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-5">
                <SectionHeading
                  id="studio-heading"
                  eyebrow={t.studio.eyebrow}
                  title={t.studio.title}
                  body={t.studio.body}
                />
                <p className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.studio.docTypesLabel}
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {t.studio.docTypes.map((doc) => (
                    <li
                      key={doc}
                      className="rounded-full border border-teal-200 bg-white px-3 py-1.5 text-sm font-medium text-teal-800 shadow-sm"
                    >
                      {doc}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lg:col-span-7">
                <StudioMockup t={t} />
              </div>
            </div>

            <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {t.studio.features.map((feature, idx) => {
                const Icon = STUDIO_ICONS[idx] ?? Check;
                return (
                  <article
                    key={feature.title}
                    className="rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-700">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-lg font-semibold text-foreground">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {feature.body}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Insights ------------------------------------------------------ */}
        <section
          id="insights"
          aria-labelledby="insights-heading"
          data-highlight="insights"
          className={`${container} scroll-mt-20 py-20 sm:py-24`}
        >
          <SectionHeading
            id="insights-heading"
            eyebrow={t.insights.eyebrow}
            title={t.insights.title}
            body={t.insights.body}
          />

          <div className="mt-14 space-y-16 sm:space-y-20">
            {t.insights.highlights.map((item, idx) => (
              <div
                key={item.key}
                className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-14"
              >
                <div className={idx % 2 === 1 ? "lg:order-2" : undefined}>
                  <span className="text-sm font-bold text-violet-600 tabular-nums">
                    0{idx + 1}
                  </span>
                  <h3 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
                    {item.body}
                  </p>
                </div>
                <div className="relative">
                  <div
                    aria-hidden="true"
                    className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-violet-500/15 via-transparent to-teal-400/15 blur-2xl"
                  />
                  <div className="relative">{insightMockups[item.key]}</div>
                </div>
              </div>
            ))}
          </div>

          <ul className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {t.insights.more.map((item, idx) => {
              const Icon = INSIGHTS_MORE_ICONS[idx] ?? Check;
              return (
                <li key={item.title} className="rounded-2xl border border-border bg-card p-5">
                  <Icon className="h-5 w-5 text-violet-600" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* AI / MCP ------------------------------------------------------ */}
        <section
          id="ai"
          aria-labelledby="ai-heading"
          data-highlight="mcp"
          className="relative scroll-mt-20 overflow-hidden bg-slate-950 py-20 text-white sm:py-24"
          style={paletteStyle}
        >
          <div className="teaser-aurora opacity-60" aria-hidden="true">
            <div className="teaser-blob" />
          </div>
          <div className={`${container} relative grid gap-12 lg:grid-cols-2 lg:items-center`}>
            <div>
              <SectionHeading
                id="ai-heading"
                eyebrow={t.ai.eyebrow}
                title={t.ai.title}
                body={t.ai.body}
                onDark
              />
              <ol className="mt-8 space-y-4">
                {t.ai.steps.map((step, idx) => {
                  const Icon = AI_STEP_ICONS[idx] ?? Check;
                  return (
                    <li key={step.title} className="flex gap-4">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal-300">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 className="font-semibold">{step.title}</h3>
                        <p className="mt-0.5 text-sm leading-relaxed text-white/70">
                          {step.body}{" "}
                          {"code" in step && (
                            <code
                              dir="ltr"
                              className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-teal-200"
                            >
                              {step.code}
                            </code>
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-8 text-sm font-semibold text-white/80">{t.ai.askAlso}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {t.ai.questions.map((q) => (
                  <li
                    key={q}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/85"
                  >
                    {locale === "he" ? `״${q}״` : `“${q}”`}
                  </li>
                ))}
              </ul>
              <Link
                href="/developers#mcp"
                className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-300 transition hover:gap-2.5"
              >
                {t.ai.devCta}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </Link>
            </div>
            <ChatMockup t={t} />
          </div>
        </section>

        {/* Audience ------------------------------------------------------ */}
        <section
          aria-labelledby="audience-heading"
          className={`${container} py-20 sm:py-24`}
        >
          <SectionHeading id="audience-heading" title={t.audience.title} align="center" />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.audience.items.map((item, idx) => {
              const Icon = AUDIENCE_ICONS[idx] ?? Check;
              return (
                <div key={item.tag} className="rounded-2xl border border-border bg-card p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{item.tag}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Pricing ------------------------------------------------------- */}
        <section
          id="pricing"
          aria-labelledby="pricing-heading"
          data-highlight="pricing"
          className="scroll-mt-20 border-y border-border bg-gradient-to-b from-primary/5 to-background py-20 sm:py-24"
        >
          <div className={container}>
            <SectionHeading
              id="pricing-heading"
              title={t.pricing.title}
              body={t.pricing.subtitle}
              align="center"
            />
            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {[
                { plan: t.pricing.studio, featured: true },
                { plan: t.pricing.byok, featured: false },
                { plan: t.pricing.ourKey, featured: false },
              ].map(({ plan, featured }) => (
                <article
                  key={plan.tag}
                  className={`relative flex flex-col rounded-2xl bg-card p-6 sm:p-8 ${
                    featured
                      ? "border-2 border-teal-500 shadow-xl"
                      : "border border-border shadow-sm"
                  }`}
                >
                  {featured && (
                    <span className="absolute -top-3 start-6 rounded-full bg-teal-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                      {t.pricing.recommended}
                    </span>
                  )}
                  <p className="text-sm font-semibold text-muted-foreground">{plan.tag}</p>
                  <p
                    className={`mt-3 font-bold tracking-tight ${
                      plan.price.length > 6 ? "text-3xl" : "text-5xl"
                    } ${featured ? "text-teal-700" : "text-foreground"}`}
                  >
                    {plan.price}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{plan.note}</p>
                  <ul className="mt-6 flex-1 space-y-3">
                    {plan.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2.5 text-sm text-foreground">
                        <Check
                          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${featured ? "text-teal-600" : "text-primary"}`}
                          aria-hidden="true"
                        />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/register"
                    className={`mt-8 inline-flex h-12 items-center justify-center rounded-lg px-6 text-sm font-semibold shadow-sm transition ${
                      featured
                        ? "bg-teal-600 text-white hover:bg-teal-700"
                        : "border border-border bg-background text-foreground hover:bg-secondary"
                    }`}
                  >
                    {plan.cta}
                  </Link>
                </article>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">{t.pricing.footnote}</p>
          </div>
        </section>

        {/* Trust / open source ------------------------------------------- */}
        <section
          aria-labelledby="trust-heading"
          data-highlight="mission"
          className={`${container} py-20 sm:py-24`}
        >
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <SectionHeading id="trust-heading" title={t.trust.title} body={t.trust.body} />
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-secondary"
              >
                <CodeXml className="h-4 w-4" aria-hidden="true" />
                {t.trust.github}
              </a>
            </div>
            <ul className="grid gap-4 lg:col-span-7">
              {t.trust.items.map((item, idx) => {
                const Icon = TRUST_ICONS[idx] ?? Check;
                return (
                  <li
                    key={item.title}
                    className="flex gap-4 rounded-2xl border border-border bg-card p-6"
                  >
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-semibold text-foreground">{item.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* FAQ ----------------------------------------------------------- */}
        <section
          id="faq"
          aria-labelledby="faq-heading"
          data-highlight="faq"
          className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-20 sm:px-6 sm:pb-24 lg:px-10"
        >
          <SectionHeading id="faq-heading" title={t.faq.title} align="center" />
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
            {t.faq.items.map((item) => (
              <details
                key={item.q}
                className="group p-5 sm:p-6 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-start justify-between gap-4 text-base font-semibold text-foreground">
                  <span>{item.q}</span>
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA ----------------------------------------------------- */}
        <section aria-labelledby="final-cta-heading" className={`${container} pb-20 sm:pb-24`}>
          <div
            className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-14 text-center text-white shadow-2xl sm:px-10 sm:py-16"
            style={paletteStyle}
          >
            <div className="teaser-aurora" aria-hidden="true">
              <div className="teaser-blob" />
            </div>
            <div className="relative mx-auto max-w-2xl">
              <h2 id="final-cta-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
                {t.finalCta.title}
              </h2>
              <p className="mt-4 text-base leading-relaxed text-white/80 sm:text-lg">
                {t.finalCta.sub}
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex h-12 items-center justify-center rounded-lg bg-white px-7 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-white/90"
                >
                  {t.finalCta.primary}
                </Link>
                <Link
                  href={localePath("/contact", locale)}
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-white/30 px-7 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {t.finalCta.secondary}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ShieldDot() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-400/15 text-teal-300"
    >
      <Check className="h-3 w-3" />
    </span>
  );
}
