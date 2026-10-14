"use client";

import { useState, useTransition } from "react";
import { ExternalLink, X } from "lucide-react";
import {
  confirmSponsorLead,
  dismissSponsoredOffer,
} from "@/actions/sponsor-actions";
import { format } from "@/lib/i18n/format";
import { useT } from "@/lib/i18n/client";
import type { SponsoredOffer as Offer } from "@/lib/sponsors/select";

type Step = "idle" | "confirm" | "sent" | "error";

/**
 * The one sponsored slot on the home dashboard.
 *
 * It sits under "Needs attention" because every offer answers something on
 * that list — unpaid invoices, VAT, no accountant — and it is set apart from
 * it on purpose: a neutral dashed surface (colour on this page means money
 * in/out or urgency), a "Sponsored" label and the partner's name. Nothing
 * reaches the partner until the user reads the exact values and confirms.
 */
export function SponsoredOffer({
  offer,
  embedded = false,
  onHidden,
}: {
  offer: Offer;
  /** Drop the card's own frame when it sits inside another surface (the top-bar popover). */
  embedded?: boolean;
  /** Called after the user hides the offer, so a host can hide itself too. */
  onHidden?: () => void;
}) {
  const t = useT().homeDash.sponsored;
  const [step, setStep] = useState<Step>("idle");
  const [whyOpen, setWhyOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const partner = { partner: offer.partnerName };

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    onHidden?.();
    startTransition(async () => {
      await dismissSponsoredOffer(offer.campaignId).catch(() => undefined);
    });
  }

  function confirm() {
    startTransition(async () => {
      const res = await confirmSponsorLead(offer.campaignId).catch(() => null);
      if (res?.ok) {
        setUrl(res.url);
        setStep("sent");
      } else {
        setStep("error");
      }
    });
  }

  const sharedList = (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {offer.sharedPreview.map((s) => (
        <div key={s.field} className="contents">
          <dt className="text-slate-500">{t.fields[s.field]}</dt>
          <dd className="truncate font-medium text-slate-800" dir="auto">
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section
      aria-label={`${t.label}: ${offer.partnerName}`}
      className={
        embedded
          ? "relative p-4"
          : "relative rounded-2xl border border-dashed border-slate-300 bg-white p-5"
      }
    >
      <button
        type="button"
        onClick={dismiss}
        disabled={isPending}
        aria-label={t.dismiss}
        title={t.dismiss}
        className="absolute end-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <X className="h-4 w-4" />
      </button>

      {offer.imageUrl ? (
        // A same-origin, admin-uploaded image; next/image would add nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={offer.imageUrl}
          alt={offer.partnerName}
          className="mb-4 aspect-[2/1] w-full rounded-xl bg-slate-100 object-cover"
        />
      ) : null}

      <div className="flex items-start gap-3 pe-6">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-700 ring-1 ring-slate-200"
        >
          {offer.partnerMark}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t.label}
            <span aria-hidden>·</span>
            <span className="font-medium normal-case tracking-normal">
              {offer.partnerName}
            </span>
          </p>
          <h3 className="text-sm font-semibold leading-snug text-slate-900">
            {offer.title}
          </h3>
          <p className="text-xs leading-relaxed text-slate-600">{offer.body}</p>
        </div>
      </div>

      {step === "idle" || step === "error" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="inline-flex h-9 items-center rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
            >
              {offer.cta}
            </button>
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              aria-expanded={whyOpen}
              className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700"
            >
              {t.why}
            </button>
          </div>
          {step === "error" ? (
            <p role="alert" className="text-xs text-rose-600">
              {t.error}
            </p>
          ) : null}
          {whyOpen ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              {format(t.reasons[offer.trigger], offer.reasonVars)}{" "}
              {format(t.privacy, partner)}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "confirm" ? (
        <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">
            {format(t.confirmTitle, partner)}
          </p>
          {sharedList}
          <p className="text-xs text-slate-500">{format(t.confirmBody, partner)}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={isPending}
              className="inline-flex h-9 items-center rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
            >
              {t.confirm}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={isPending}
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {step === "sent" && url ? (
        <div className="mt-4 space-y-2 rounded-xl bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">
            {format(t.sentTitle, partner)}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 underline underline-offset-2"
          >
            {format(t.continue, partner)}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      ) : null}
    </section>
  );
}
