import Image from "next/image";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/server";
import { getTeaserConfig, type TeaserSlug } from "@/lib/teasers/config";
import { getFeatureInterestState } from "@/actions/feature-interest-actions";
import { FeatureTeaserVote } from "./feature-teaser-vote";
import "./teaser-aurora.css";

interface Props {
  slug: TeaserSlug;
  /** Outer wrapper class so callers can control top/bottom spacing. */
  className?: string;
}

/**
 * Landing-page teaser card. Server component — fetches the live vote count
 * and primes the client button with the viewer's existing vote state so
 * the UI renders correctly on first paint (no flash of "0 votes").
 *
 * Visual: aurora gradient background, glassmorphic card with conic-gradient
 * border, gradient-clipped accent headline, bullet list, vote pill. All
 * animations are pure CSS (see teaser-aurora.css) and respect
 * `prefers-reduced-motion`.
 */
export async function FeatureTeaser({ slug, className }: Props) {
  const config = getTeaserConfig(slug);
  if (!config) return null;

  const [locale, state] = await Promise.all([
    getLocale(),
    getFeatureInterestState(slug),
  ]);

  const copy = config.copy[locale] ?? config.copy.en;
  const { palette } = config;

  // Inline CSS variables so each teaser can ship its own palette without
  // touching the shared stylesheet.
  const paletteStyle = {
    "--teaser-a": palette.a,
    "--teaser-b": palette.b,
    "--teaser-c": palette.c,
  } as React.CSSProperties;

  return (
    <section
      aria-labelledby={`teaser-${slug}-heading`}
      className={className}
    >
      <div
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950 px-6 py-12 text-white shadow-2xl shadow-violet-500/10 sm:px-10 sm:py-16 lg:px-16"
        style={paletteStyle}
      >
        <div className="teaser-aurora" aria-hidden="true">
          <div className="teaser-blob" />
        </div>

        {config.decorImage && (
          <div className="absolute end-6 top-6 hidden opacity-30 sm:block lg:end-12 lg:top-12 lg:opacity-50">
            <div className="teaser-tilt">
              <Image
                src={config.decorImage.src}
                alt={config.decorImage.alt}
                width={120}
                height={120}
                className="h-20 w-20 lg:h-28 lg:w-28"
              />
            </div>
          </div>
        )}

        <div className="teaser-card relative mx-auto max-w-3xl rounded-2xl bg-white/[0.04] p-6 backdrop-blur-sm sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-white">
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                style={{ background: palette.c }}
              />
              <span
                className="relative inline-flex h-2 w-2 rounded-full"
                style={{ background: palette.c }}
              />
            </span>
            {copy.eyebrow}
          </div>

          <h2
            id={`teaser-${slug}-heading`}
            className="mt-6 text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl"
          >
            <span>{copy.titleLead}</span>{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(90deg, ${palette.a}, ${palette.b}, ${palette.c})`,
              }}
            >
              {copy.titleAccent}
            </span>
          </h2>

          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg">
            {copy.pitch}
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {copy.bullets.map((bullet) => (
              <li
                key={bullet}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/90"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-slate-950"
                  style={{ background: palette.b }}
                >
                  ✓
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:flex-wrap">
            <FeatureTeaserVote
              slug={slug}
              initialCount={state.count}
              initialVoted={state.hasVoted}
              copy={copy}
            />
            <Link
              href={config.learnMoreHref}
              className="inline-flex h-12 items-center justify-center gap-1.5 rounded-full border border-white/25 bg-white/5 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              {copy.learnMoreCta}
              <span aria-hidden="true" className="rtl:rotate-180">
                →
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
