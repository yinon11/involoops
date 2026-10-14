"use client";

import { useState, useTransition } from "react";
import { castFeatureInterestVote } from "@/actions/feature-interest-actions";
import type { TeaserCopy } from "@/lib/teasers/config";

interface Props {
  slug: string;
  initialCount: number;
  initialVoted: boolean;
  copy: Pick<
    TeaserCopy,
    "voteCta" | "voteCtaVoted" | "voteCount" | "voteCountOne"
  >;
  /** Compact variant used in the dashboard banner. */
  compact?: boolean;
}

/**
 * Interactive vote pill. Optimistically flips to the voted state on click,
 * fires the server action, then reconciles with the authoritative count.
 *
 * Confetti, count-up and the heart are pure CSS (see teaser-aurora.css).
 * We deliberately avoid Framer Motion / motion to keep the landing-page
 * bundle lean.
 */
export function FeatureTeaserVote({
  slug,
  initialCount,
  initialVoted,
  copy,
  compact = false,
}: Props) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(initialVoted);
  const [showConfetti, setShowConfetti] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const formatCount = (n: number) =>
    n === 1 ? copy.voteCountOne : copy.voteCount.replace("{count}", String(n));

  const onClick = () => {
    if (isPending) return;
    setError(null);
    const wasVoted = voted;

    if (!wasVoted) {
      // Optimistic flip — gives instant feedback even if the server action
      // is slow. We reconcile from the response below.
      setVoted(true);
      setCount((c) => c + 1);
      setShowConfetti(true);
      window.setTimeout(() => setShowConfetti(false), 750);
    }

    startTransition(async () => {
      const res = await castFeatureInterestVote(slug);
      if (!res.ok) {
        setError(res.error);
        if (!wasVoted) {
          setVoted(false);
          setCount((c) => Math.max(0, c - 1));
        }
        return;
      }
      setCount(res.count);
      setVoted(true);
    });
  };

  const buttonClasses = compact
    ? "teaser-vote-btn inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-1.5 text-xs font-semibold text-foreground shadow-sm hover:bg-white"
    : "teaser-vote-btn relative inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-3 text-sm font-semibold text-background shadow-lg shadow-black/20 hover:shadow-xl";

  return (
    <div className={compact ? "flex items-center gap-3" : "flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4"}>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        data-voted={voted ? "true" : "false"}
        aria-pressed={voted}
        className={buttonClasses}
      >
        <span aria-hidden="true">{voted ? "✓" : "♡"}</span>
        <span>{voted ? copy.voteCtaVoted : copy.voteCta}</span>
        {showConfetti && (
          <span className="teaser-confetti" aria-hidden="true">
            <span /><span /><span /><span /><span /><span />
          </span>
        )}
      </button>

      <p
        className={
          compact
            ? "text-xs font-medium text-white/90"
            : "text-sm font-medium text-muted-foreground"
        }
        aria-live="polite"
      >
        {voted && (
          <span className="teaser-heart me-1.5 text-pink-400" aria-hidden="true">
            ❤
          </span>
        )}
        <span key={count} className="teaser-count tabular-nums">
          {formatCount(count)}
        </span>
      </p>

      {error && (
        <p className="text-xs text-red-200" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
