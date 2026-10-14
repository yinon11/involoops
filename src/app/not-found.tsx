"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import {
  FileSearch,
  FileWarning,
  FileX,
  Home,
  LayoutDashboard,
  Receipt,
  Sparkles,
} from "lucide-react";

export default function NotFound() {
  const t = useT().notFound;

  return (
    <main
      aria-labelledby="not-found-heading"
      className="relative isolate flex min-h-[calc(100vh-8rem)] flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-violet-50 via-white to-indigo-50 px-4 py-16 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950"
    >
      <BackgroundDecor />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <span className="nf-fade-up inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-wider text-violet-700 shadow-sm backdrop-blur dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
          <Sparkles className="size-3.5" aria-hidden />
          {t.badge}
        </span>

        <Glitch404 />

        <h1
          id="not-found-heading"
          className="nf-fade-up nf-delay-2 mt-6 text-balance bg-gradient-to-br from-slate-900 to-slate-600 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl md:text-5xl dark:from-white dark:to-slate-300"
        >
          {t.heading}
        </h1>

        <p className="nf-fade-up nf-delay-3 mt-4 max-w-xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
          {t.subheading}
        </p>

        <div
          className="nf-fade-up nf-delay-4 mt-8 w-full max-w-md rounded-xl border border-slate-200/80 bg-white/80 p-5 text-start shadow-lg shadow-violet-500/5 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/60"
          role="group"
          aria-label={t.detailsTitle}
        >
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <FileWarning className="size-4 text-amber-500" aria-hidden />
            {t.detailsTitle}
          </div>
          <dl className="grid gap-2 text-sm">
            <DetailRow label={t.details.status} value={t.details.statusValue} />
            <DetailRow
              label={t.details.lastSeen}
              value={t.details.lastSeenValue}
            />
            <DetailRow label={t.details.vendor} value={t.details.vendorValue} />
            <DetailRow label={t.details.vat} value={t.details.vatValue} />
          </dl>
        </div>

        <div className="nf-fade-up nf-delay-5 mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/dashboard">
              <LayoutDashboard className="size-4" aria-hidden />
              {t.primaryCta}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/">
              <Home className="size-4" aria-hidden />
              {t.secondaryCta}
            </Link>
          </Button>
        </div>

        <p className="nf-fade-up nf-delay-6 mt-8 max-w-md text-xs italic text-slate-500 dark:text-slate-400">
          {t.footnote}
        </p>
      </div>

      <NotFoundStyles />
    </main>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-slate-200 pb-2 last:border-b-0 last:pb-0 dark:border-slate-700">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-end font-medium text-slate-800 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

function Glitch404() {
  return (
    <div
      className="nf-fade-up nf-delay-1 relative mt-6 select-none"
      aria-hidden
    >
      <div className="nf-glitch text-[6.5rem] font-black leading-none tracking-tighter sm:text-[9rem] md:text-[11rem]">
        <span
          className="bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-500 bg-clip-text text-transparent"
          data-text="404"
        >
          404
        </span>
      </div>
      <FileSearch
        className="nf-magnifier absolute -bottom-2 end-[-1.25rem] size-12 text-violet-600 drop-shadow-md sm:size-16 md:size-20 dark:text-violet-300"
        aria-hidden
      />
    </div>
  );
}

function BackgroundDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-violet-300/30 blur-3xl dark:bg-violet-500/10" />
      <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-indigo-300/30 blur-3xl dark:bg-indigo-500/10" />

      <FloatingPaper
        className="left-[8%] top-[18%] hidden sm:block"
        delay="0s"
        rotate="-12deg"
        icon="receipt"
      />
      <FloatingPaper
        className="right-[10%] top-[24%] hidden sm:block"
        delay="1.2s"
        rotate="9deg"
        icon="x"
      />
      <FloatingPaper
        className="left-[12%] bottom-[14%] hidden md:block"
        delay="2s"
        rotate="6deg"
        icon="receipt"
      />
      <FloatingPaper
        className="right-[14%] bottom-[18%] hidden md:block"
        delay="0.6s"
        rotate="-8deg"
        icon="x"
      />
    </div>
  );
}

function FloatingPaper({
  className = "",
  delay = "0s",
  rotate = "0deg",
  icon,
}: {
  className?: string;
  delay?: string;
  rotate?: string;
  icon: "receipt" | "x";
}) {
  const Icon = icon === "receipt" ? Receipt : FileX;
  return (
    <div
      className={`nf-float absolute size-14 rounded-lg border border-slate-200 bg-white/80 p-3 shadow-md backdrop-blur sm:size-16 dark:border-slate-700 dark:bg-slate-800/70 ${className}`}
      style={{
        animationDelay: delay,
        ["--nf-rot" as string]: rotate,
      }}
    >
      <Icon
        className={`size-full ${
          icon === "x"
            ? "text-rose-400 dark:text-rose-300"
            : "text-violet-500 dark:text-violet-300"
        }`}
        aria-hidden
      />
    </div>
  );
}

function NotFoundStyles() {
  return (
    <style>{`
      @keyframes nf-fade-up {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes nf-float {
        0%   { transform: translateY(0) rotate(var(--nf-rot, 0deg)); }
        50%  { transform: translateY(-14px) rotate(calc(var(--nf-rot, 0deg) + 4deg)); }
        100% { transform: translateY(0) rotate(var(--nf-rot, 0deg)); }
      }
      @keyframes nf-magnifier {
        0%, 100% { transform: translate(0, 0) rotate(-8deg); }
        25%      { transform: translate(-10px, -6px) rotate(-18deg); }
        50%      { transform: translate(-2px, -10px) rotate(-2deg); }
        75%      { transform: translate(8px, -4px) rotate(10deg); }
      }
      @keyframes nf-glitch {
        0%, 92%, 100% { transform: translate(0, 0); filter: none; }
        93% { transform: translate(-2px, 1px); filter: hue-rotate(20deg); }
        95% { transform: translate(2px, -1px); filter: hue-rotate(-30deg); }
        97% { transform: translate(-1px, 0); filter: none; }
      }
      .nf-fade-up { opacity: 0; animation: nf-fade-up 0.7s ease-out forwards; }
      .nf-delay-1 { animation-delay: 0.05s; }
      .nf-delay-2 { animation-delay: 0.15s; }
      .nf-delay-3 { animation-delay: 0.25s; }
      .nf-delay-4 { animation-delay: 0.35s; }
      .nf-delay-5 { animation-delay: 0.45s; }
      .nf-delay-6 { animation-delay: 0.55s; }
      .nf-float { animation: nf-float 6s ease-in-out infinite; }
      .nf-magnifier { animation: nf-magnifier 4.5s ease-in-out infinite; transform-origin: center; }
      .nf-glitch { animation: nf-glitch 5s steps(1, end) infinite; }
      @media (prefers-reduced-motion: reduce) {
        .nf-fade-up, .nf-float, .nf-magnifier, .nf-glitch {
          animation: none !important;
          opacity: 1 !important;
          transform: none !important;
        }
      }
    `}</style>
  );
}
