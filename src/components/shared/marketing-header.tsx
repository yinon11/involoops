import Link from "next/link";
import Image from "next/image";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { localePath } from "@/lib/seo/metadata";
import type { Locale } from "@/lib/i18n";

const container = "mx-auto max-w-6xl px-4 sm:px-6 lg:px-10";

type NavLabels = {
  studio: string;
  insights: string;
  ai: string;
  pricing: string;
  faq: string;
  license: string;
  login: string;
  cta: string;
};

/**
 * Sticky public header shared by the home page and other pre-login pages.
 * Section links always point at the home page anchors so they still work
 * after the visitor has left `/`.
 */
export function MarketingHeader({
  locale,
  appName,
  navLabel,
  nav,
}: {
  locale: Locale;
  appName: string;
  navLabel: string;
  nav: NavLabels;
}) {
  const home = localePath("/", locale);
  const items = [
    { href: `${home}#studio`, label: nav.studio },
    { href: `${home}#insights`, label: nav.insights },
    { href: `${home}#ai`, label: nav.ai },
    { href: `${home}#pricing`, label: nav.pricing },
    { href: `${home}#faq`, label: nav.faq },
    { href: localePath("/license", locale), label: nav.license },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className={`${container} flex items-center justify-between gap-3 py-3`}>
        <Link
          href={home}
          className="flex min-w-0 items-center gap-2"
          aria-label={appName}
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
            alt={appName}
            width={520}
            height={130}
            className="hidden h-8 w-auto sm:block"
            priority
          />
        </Link>
        <nav aria-label={navLabel} className="hidden items-center gap-1 lg:flex">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/80 transition hover:bg-secondary hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
          <LanguageSwitcher variant="onLight" />
          <Link
            href={localePath("/license", locale)}
            className="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-foreground/80 transition hover:bg-secondary hover:text-foreground lg:hidden"
          >
            {nav.license}
          </Link>
          <Link
            href="/login"
            className="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-foreground/80 transition hover:bg-secondary hover:text-foreground sm:px-3"
          >
            {nav.login}
          </Link>
          <Link
            href="/register"
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 sm:px-4"
          >
            {nav.cta}
          </Link>
        </div>
      </div>
    </header>
  );
}
