"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { SponsoredOffer as Offer } from "@/lib/sponsors/select";

/**
 * Full-width header banner with image - integrated into header.
 */
export function HeaderSponsorSlot({ offer }: { offer: Offer }) {
  const t = useT().homeDash.sponsored;
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  // A campaign that ships artwork gets the whole bar: the creative carries its
  // own copy, so repeating the title beside it would only duplicate it. The
  // text composition below is the fallback for campaigns with no image.
  // `md:-my-3` cancels the header's own vertical padding so the creative fills
  // the bar edge to edge. Its margin box still measures the same as the
  // controls beside it, so the header keeps its height. Only from md up: on
  // phones this is a separate wrapped row, where a negative margin would pull
  // it over the row above.
  if (offer.imageUrl) {
    return (
      <div className="relative w-full md:-my-3">
        {/* The creative is a plain outbound link: it carries its own copy and
            sends nothing about the user. Sharing their details is a separate,
            explicit step (`confirmSponsorLead`) and is not wired up here. */}
        <a
          href={offer.ctaUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          aria-label={`${t.label} · ${offer.partnerName} — ${offer.title}`}
          className="block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={offer.imageUrl}
            alt={`${t.label} · ${offer.partnerName} — ${offer.title}`}
            className="block h-10 w-full rounded-md object-cover md:h-16 md:rounded-none"
          />
        </a>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label={t.dismiss}
          className="absolute end-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/25 text-white/90 transition-colors hover:bg-black/50 hover:text-white"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-4 bg-gradient-to-r from-slate-50 to-white px-4 py-2 border-b border-slate-200">
      <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded-md bg-slate-200 text-sm font-bold text-slate-600">
        {offer.partnerMark}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {t.label} · {offer.partnerName}
        </p>
        <p className="text-sm font-medium text-slate-900">{offer.title}</p>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label={t.dismiss}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
