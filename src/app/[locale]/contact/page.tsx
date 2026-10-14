import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  Accessibility,
  ArrowRight,
  CheckCircle2,
  Clock,
  Code2,
  Mail,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ContactForm } from "./contact-form";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { buildMetadata, localePath } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/contact",
    copy: {
      en: {
        title: "Contact InvoLoops",
        description:
          "Get in touch with the InvoLoops team. Send us your questions, feedback, or support requests and we'll reply by email — usually within one business day.",
      },
      he: {
        title: "צור קשר עם InvoLoops",
        description:
          "צרו קשר עם צוות InvoLoops. שלחו לנו שאלות, משוב או בקשות תמיכה ונחזור אליכם במייל — בדרך כלל תוך יום עסקים.",
      },
    },
  });
}

export default async function ContactPage() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = dict.contact;

  const helpfulLinks: Array<{
    href: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      // /developers stays English-only by design (see developers/layout.tsx),
      // so its href is intentionally not locale-prefixed.
      href: "/developers",
      title: t.helpfulLinks.developers,
      description: t.helpfulLinks.developersDescription,
      icon: Code2,
    },
    {
      href: localePath("/accessibility", locale),
      title: t.helpfulLinks.accessibility,
      description: t.helpfulLinks.accessibilityDescription,
      icon: Accessibility,
    },
    {
      href: localePath("/privacy", locale),
      title: t.helpfulLinks.privacy,
      description: t.helpfulLinks.privacyDescription,
      icon: ShieldCheck,
    },
    {
      href: localePath("/terms", locale),
      title: t.helpfulLinks.terms,
      description: t.helpfulLinks.termsDescription,
      icon: ScrollText,
    },
  ];

  const tipItems = [
    t.tips.items.steps,
    t.tips.items.evidence,
    t.tips.items.urgency,
    t.tips.items.contact,
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent blur-2xl"
      />

      {/* Site header — kept consistent with the other marketing pages
          (homepage, /learn). The
          existing page-level "Contact us" hero below is unchanged. We
          intentionally omit a "Contact" link since this page is the
          contact destination. */}
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
            className="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground sm:px-4"
          >
            {dict.home.nav.tutorials}
          </Link>
          <Link
            href="/login"
            className="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground sm:px-4"
          >
            {dict.home.nav.login}
          </Link>
          <Link
            href="/register"
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 sm:px-5"
          >
            {dict.home.nav.getStarted}
          </Link>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <header className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {t.badge}
          </div>
          <h1
            data-highlight="contact-title"
            className="mt-5 text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl"
          >
            {t.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t.description}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground sm:text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1">
              <Clock className="h-3.5 w-3.5 text-primary" />
              {t.info.responseDescription}
            </span>
          </div>
        </header>

        <section className="mt-12 grid gap-6 lg:mt-16 lg:grid-cols-5 lg:gap-8">
          <div className="lg:col-span-3" data-highlight="contact-form">
            <ContactForm />
          </div>

          <aside className="space-y-4 lg:col-span-2">
            <div
              data-highlight="contact-email"
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {t.info.emailTitle}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t.info.emailDescription}
                  </p>
                  <a
                    href={`mailto:${t.info.emailAddress}`}
                    className="mt-3 inline-flex items-center gap-1.5 break-all text-sm font-medium text-primary hover:underline"
                  >
                    {t.info.emailAddress}
                    <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                  </a>
                </div>
              </div>
            </div>

            <div
              data-highlight="contact-hours"
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t.info.hoursTitle}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t.info.hoursDescription}
                  </p>
                </div>
              </div>
            </div>

            <div
              data-highlight="contact-tips"
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t.tips.title}
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {tipItems.map((tip) => (
                      <li
                        key={tip}
                        className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary/70" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-16" data-highlight="contact-links">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {t.helpfulLinks.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.helpfulLinks.subtitle}
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {helpfulLinks.map(({ href, title, description, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary/15">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                    <span className="truncate">{title}</span>
                    <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
