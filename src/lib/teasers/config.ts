/**
 * Catalogue of "coming soon" feature teasers.
 *
 * One entry per teased feature. Rendering surfaces (`<FeatureTeaser>` on the
 * landing page, `<FeatureTeaserBanner>` inside the app) read this map by
 * slug. Adding a new teaser is a single object literal — no DB migration,
 * no component edits. To remove one, drop the entry; the (now-orphaned)
 * vote rows in `feature_interest_votes` stay for analytics.
 *
 * Copy lives here in EN + HE rather than in the i18n dictionaries so a
 * marketer can ship a teaser by editing one file.
 */

export const TEASER_SLUGS = ["invoice-generator"] as const;
export type TeaserSlug = (typeof TEASER_SLUGS)[number];

export interface TeaserCopy {
  /** Pill above the headline, e.g. "Coming soon". */
  eyebrow: string;
  /** Plain-text portion of the headline rendered in foreground colour. */
  titleLead: string;
  /** Gradient-clipped accent portion of the headline. */
  titleAccent: string;
  /** ~25-word pitch shown under the headline. */
  pitch: string;
  /** 3-4 short bullets ("✓ Multi-currency", "✓ One-click PDF"). */
  bullets: string[];
  /** Vote button label in its idle state. */
  voteCta: string;
  /** Vote button label after the viewer has voted. */
  voteCtaVoted: string;
  /**
   * Live count template. `{count}` gets replaced. Singular/plural handled
   * by the component via `voteCountOne` when count === 1.
   */
  voteCount: string;
  voteCountOne: string;
  /** Compact one-liner for the dashboard banner variant. */
  bannerLine: string;
  /** Banner CTA ("I want this") — shorter than the landing-page CTA. */
  bannerCta: string;
  /** Secondary CTA on the teaser ("Learn more"). */
  learnMoreCta: string;
  /** Alt text for the dedicated landing page hero screenshot. */
  screenshotAlt: string;
}

export interface TeaserConfig {
  slug: TeaserSlug;
  /**
   * Brand-aligned palette used by the aurora background. Three colours,
   * roughly violet / teal / accent. Hex strings so we can pass them
   * straight into inline `background` styles.
   */
  palette: { a: string; b: string; c: string };
  /** Optional decorative SVG shown floating in the card corner. */
  decorImage?: { src: string; alt: string };
  /**
   * Public route for the dedicated "learn more" page. Used by both the
   * landing-page teaser and the dashboard banner secondary CTA.
   */
  learnMoreHref: string;
  /**
   * Per-locale screenshot rendered on the dedicated landing page. Pick
   * the file matching the active locale at render time so Hebrew users
   * see the RTL UI and English users see the LTR UI.
   */
  screenshots: Record<"en" | "he", { src: string; width: number; height: number }>;
  /** Server paths to revalidate after a vote (so counts stay fresh). */
  revalidatePaths?: string[];
  copy: Record<"en" | "he", TeaserCopy>;
}

const TEASERS: Record<TeaserSlug, TeaserConfig> = {
  "invoice-generator": {
    slug: "invoice-generator",
    palette: {
      // Brand violet, brand teal, warm pink accent. The aurora background
      // animates these three blobs across the canvas; the gradient pill
      // border uses them in order.
      a: "#7c3aed",
      b: "#14b8a6",
      c: "#f472b6",
    },
    decorImage: {
      src: "/brand/involoops-mark-violet.svg",
      alt: "",
    },
    learnMoreHref: "/#studio",
    screenshots: {
      en: {
        src: "/teasers/invoice-generator/dashboard-en.jpg",
        width: 1024,
        height: 571,
      },
      he: {
        src: "/teasers/invoice-generator/dashboard-he.jpg",
        width: 1024,
        height: 571,
      },
    },
    revalidatePaths: ["/", "/dashboard"],
    copy: {
      en: {
        eyebrow: "✨ Coming soon",
        titleLead: "Send invoices to your customers,",
        titleAccent: "in seconds.",
        pitch:
          "We're opening the InvoLoops Invoice Generator to everyone. Issue beautiful, compliant invoices, send them by email, and get paid — all from the same dashboard you already love.",
        bullets: [
          "Branded templates with your logo and colours",
          "Multi-currency, multi-language, ITA-ready (Israel)",
          "One-click email delivery and PDF export",
          "Customer book, payment tracking, credit notes",
        ],
        voteCta: "I want this — count me in",
        voteCtaVoted: "You're on the list",
        voteCount: "{count} people are waiting",
        voteCountOne: "1 person is waiting",
        bannerLine:
          "Coming soon: issue and send invoices to your own customers — straight from InvoLoops.",
        bannerCta: "I want this",
        learnMoreCta: "Learn more",
        screenshotAlt:
          "InvoLoops Studio dashboard — issue invoices, manage customers, track revenue.",
      },
      he: {
        eyebrow: "✨ בקרוב",
        titleLead: "שליחת חשבוניות ללקוחות שלכם,",
        titleAccent: "בכמה שניות.",
        pitch:
          "אנחנו פותחים את מחולל החשבוניות של InvoLoops לכולם. הפיקו חשבוניות מעוצבות ותקניות, שלחו במייל וקבלו תשלום — הכול מאותו לוח בקרה שאתם כבר מכירים.",
        bullets: [
          "תבניות ממותגות עם הלוגו והצבעים שלכם",
          "ריבוי מטבעות ושפות, מוכן לשע״ם (ישראל)",
          "שליחה במייל בלחיצה אחת והורדת PDF",
          "ספר לקוחות, מעקב תשלומים וזיכויים",
        ],
        voteCta: "אני רוצה את זה — סמנו אותי",
        voteCtaVoted: "אתם ברשימה",
        voteCount: "{count} משתמשים מחכים",
        voteCountOne: "משתמש אחד מחכה",
        bannerLine:
          "בקרוב: הפקה ושליחה של חשבוניות ללקוחות שלכם — ישירות מ־InvoLoops.",
        bannerCta: "אני רוצה",
        learnMoreCta: "מידע נוסף",
        screenshotAlt:
          "מסך InvoLoops Studio — הפקת חשבוניות, ניהול לקוחות ומעקב הכנסות.",
      },
    },
  },
};

export function getTeaserConfig(slug: TeaserSlug): TeaserConfig | undefined {
  return TEASERS[slug];
}

export function listTeasers(): TeaserConfig[] {
  return TEASER_SLUGS.map((s) => TEASERS[s]);
}
