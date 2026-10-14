"use client";

import { ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { SponsoredOffer } from "./sponsored-offer";
import type { SponsoredOffer as Offer } from "@/lib/sponsors/select";

/**
 * Preview mode showing all placement options at once, without dismissal.
 * Helps choose where to display the ad before running the campaign.
 */
export function SponsorPreviewShowcase({ offer }: { offer: Offer }) {
  const t = useT();

  return (
    <div className="space-y-8 rounded-2xl border-2 border-blue-200 bg-blue-50/50 p-6">
      <div>
        <h2 className="mb-1 text-lg font-bold text-slate-900">
          📍 Campaign Placement Preview
        </h2>
        <p className="text-sm text-slate-600">
          Click through each placement below to see how the ad looks in different positions.
          No clicks are tracked in preview mode.
        </p>
      </div>

      <div className="space-y-6">
        {/* Placement 1: Dashboard Card (current) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              1
            </span>
            <h3 className="font-semibold text-slate-900">Dashboard Card</h3>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Current
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Appears below the “Needs Attention” section on the home page. Takes full width, highly visible.
          </p>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <SponsoredOffer offer={offer} />
          </div>
        </div>

        {/* Placement 2: Header Pill (current) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              2
            </span>
            <h3 className="font-semibold text-slate-900">Header Pill (Top Bar)</h3>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Current
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Compact pill in the top navigation bar. Always visible, opens expanded view in popover.
          </p>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2">
            {offer.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={offer.imageUrl}
                alt=""
                className="h-6 w-12 shrink-0 rounded-md bg-slate-100 object-cover"
              />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200">
                {offer.partnerMark}
              </span>
            )}
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Sponsored
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
              {offer.title}
            </span>
          </div>
        </div>

        {/* Placement 3: Side Panel (concept) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-white">
              3
            </span>
            <h3 className="font-semibold text-slate-900">Sidebar Widget (Concept)</h3>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Preview Only
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Small card in the right sidebar. Less intrusive, good for secondary visibility.
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3 lg:col-span-1">
              <div className="space-y-3">
                {offer.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={offer.imageUrl}
                    alt=""
                    className="w-full rounded-lg bg-slate-100 object-cover"
                  />
                ) : null}
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-semibold uppercase text-slate-400">
                      Sponsored
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-900 line-clamp-2">
                    {offer.title}
                  </p>
                  <p className="text-[11px] text-slate-600 line-clamp-2">{offer.body}</p>
                </div>
                <button className="w-full rounded-lg bg-slate-900 py-1.5 text-[10px] font-semibold text-white hover:bg-slate-700">
                  {offer.cta}
                </button>
              </div>
            </div>
            <div className="hidden lg:block"></div>
            <div className="hidden lg:block"></div>
          </div>
        </div>

        {/* Placement 4: Inline Banner (concept) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-white">
              4
            </span>
            <h3 className="font-semibold text-slate-900">Inline Banner (Concept)</h3>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Preview Only
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Horizontal banner between sections. High visibility, takes up significant space.
          </p>
          <div className="rounded-xl border-2 border-slate-400 bg-gradient-to-r from-slate-50 to-slate-100 p-4">
            <div className="flex items-center gap-4">
              {offer.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={offer.imageUrl}
                  alt=""
                  className="h-20 w-32 rounded-lg bg-slate-100 object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl font-bold text-slate-700 ring-1 ring-slate-200">
                  {offer.partnerMark}
                </div>
              )}
              <div className="flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Sponsored Offer
                </p>
                <h4 className="font-semibold text-slate-900">{offer.title}</h4>
                <p className="text-sm text-slate-600">{offer.body}</p>
              </div>
              <button className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                {offer.cta}
              </button>
            </div>
          </div>
        </div>

        {/* Placement 5: Modal/Popup (concept) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-white">
              5
            </span>
            <h3 className="font-semibold text-slate-900">Modal Popup (Concept)</h3>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Preview Only
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Full-screen modal on page load. Maximum impact, but can be intrusive.
          </p>
          <div className="rounded-2xl border-2 border-slate-300 bg-white p-6 shadow-xl">
            <div className="mx-auto max-w-sm space-y-4">
              {offer.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={offer.imageUrl}
                  alt=""
                  className="w-full rounded-xl bg-slate-100 object-cover"
                />
              ) : null}
              <div className="space-y-2 text-center">
                <h4 className="text-lg font-bold text-slate-900">{offer.title}</h4>
                <p className="text-sm text-slate-600">{offer.body}</p>
              </div>
              <button className="w-full rounded-lg bg-slate-900 py-2.5 font-semibold text-white hover:bg-slate-700">
                {offer.cta}
              </button>
              <button className="w-full rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-medium text-amber-900">
          💡 <strong>Tip:</strong> You’re in preview mode. No events are tracked. Once you
          decide on a placement, set it in the admin panel and we’ll activate it.
        </p>
      </div>
    </div>
  );
}
