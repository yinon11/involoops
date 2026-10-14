"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { dismissSponsoredOffer } from "@/actions/sponsor-actions";
import { useT } from "@/lib/i18n/client";
import type { SponsoredOffer as Offer } from "@/lib/sponsors/select";

/**
 * Full-width banner sponsorship between dashboard sections.
 * Shows partner image + offer details side-by-side.
 */
export function BannerSponsorSlot({ offer }: { offer: Offer }) {
  const t = useT().homeDash.sponsored;
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    dismissSponsoredOffer(offer.campaignId).catch(() => undefined);
  }

  console.log("BannerSponsorSlot rendering with offer:", offer.partnerName, "image:", offer.imageUrl);

  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 p-6 shadow-sm">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t.dismiss}
        title={t.dismiss}
        className="absolute right-6 top-6 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-6">
        {/* Image section */}
        {offer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.imageUrl}
            alt={offer.partnerName}
            className="h-32 w-48 shrink-0 rounded-lg bg-slate-100 object-cover"
          />
        ) : (
          <div className="flex h-32 w-48 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-4xl font-bold text-slate-600">
            {offer.partnerMark}
          </div>
        )}

        {/* Content section */}
        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t.label} · {offer.partnerName}
            </p>
            <h3 className="text-xl font-bold text-slate-900">{offer.title}</h3>
            <p className="text-sm text-slate-700">{offer.body}</p>
          </div>

          <a
            href={offer.imageUrl ? "#" : "#"}
            className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
          >
            {offer.cta}
          </a>
        </div>
      </div>
    </div>
  );
}
