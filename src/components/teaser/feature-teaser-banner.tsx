"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { FeatureTeaserVote } from "./feature-teaser-vote";
import type { TeaserConfig } from "@/lib/teasers/config";
import "./teaser-aurora.css";

interface Props {
  config: TeaserConfig;
  locale: "en" | "he";
  initialCount: number;
  initialVoted: boolean;
  closeLabel: string;
}

const STORAGE_PREFIX = "involoops:teaser-dismissed:";

/** Subscribe to cross-tab `storage` events so a dismiss in one tab hides
 *  the banner in others without a refresh. */
function subscribeStorage(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function readDismissed(slug: string): boolean {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${slug}`) === "1";
  } catch {
    return false;
  }
}

/**
 * Slim, dismissible banner shown above the dashboard. The dismiss flag is
 * stored in localStorage keyed by the teaser slug, so it's per-browser and
 * permanent until the user clears their storage. Each new teaser slug
 * starts fresh — old slugs stay dismissed but don't block new ones.
 *
 * Uses `useSyncExternalStore` to read the dismiss flag — that's the
 * React 19-recommended way to subscribe to external mutable sources like
 * `localStorage` without triggering the `set-state-in-effect` rule. The
 * server snapshot returns "not dismissed" so the markup renders, then the
 * client switches to the real value on hydration; users who dismissed see
 * a brief flash but it's better than guessing wrong on the server. We
 * also gate on a separate `localDismiss` so clicking ✕ feels instant
 * without waiting for a storage event roundtrip.
 */
export function FeatureTeaserBanner({
  config,
  locale,
  initialCount,
  initialVoted,
  closeLabel,
}: Props) {
  const copy = config.copy[locale] ?? config.copy.en;
  const { palette } = config;

  const subscribe = useCallback(
    (cb: () => void) => subscribeStorage(cb),
    [],
  );
  const getSnapshot = useCallback(
    () => readDismissed(config.slug),
    [config.slug],
  );
  // Server has no localStorage; assume "not dismissed" so SEO crawlers and
  // first-time visitors see the banner. Returning a constant keeps
  // hydration consistent.
  const getServerSnapshot = useCallback(() => false, []);

  const persistedDismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [localDismiss, setLocalDismiss] = useState(false);

  const dismiss = () => {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${config.slug}`, "1");
    } catch {
      /* ignore quota / private mode */
    }
    setLocalDismiss(true);
  };

  if (persistedDismissed || localDismiss) return null;

  const paletteStyle = {
    "--teaser-a": palette.a,
    "--teaser-b": palette.b,
    "--teaser-c": palette.c,
  } as React.CSSProperties;

  return (
    <div
      className="teaser-banner-enter relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white shadow-lg sm:px-6 sm:py-4"
      style={paletteStyle}
      role="region"
      aria-label={copy.eyebrow}
    >
      <div className="teaser-aurora" aria-hidden="true">
        <div className="teaser-blob" />
      </div>

      <div className="relative flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-center gap-3">
          {config.decorImage && (
            <div className="hidden flex-shrink-0 sm:block">
              <div className="teaser-tilt">
                <Image
                  src={config.decorImage.src}
                  alt={config.decorImage.alt}
                  width={36}
                  height={36}
                  className="h-9 w-9"
                />
              </div>
            </div>
          )}
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: palette.c }}
              />
              {copy.eyebrow}
            </span>
            <p className="mt-1 text-sm font-medium leading-snug text-white sm:text-base">
              {copy.bannerLine}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <FeatureTeaserVote
            slug={config.slug}
            initialCount={initialCount}
            initialVoted={initialVoted}
            copy={{
              voteCta: copy.bannerCta,
              voteCtaVoted: copy.voteCtaVoted,
              voteCount: copy.voteCount,
              voteCountOne: copy.voteCountOne,
            }}
            compact
          />
          <Link
            href={config.learnMoreHref}
            className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10 hover:text-white"
          >
            {copy.learnMoreCta}
            <span aria-hidden="true" className="rtl:rotate-180">
              →
            </span>
          </Link>
          <button
            type="button"
            onClick={dismiss}
            aria-label={closeLabel}
            className="rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
