import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AttentionTone = "urgent" | "warning" | "info";

export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  icon: ReactNode;
  title: string;
  meta?: string;
  href: string;
  /** Optional inline control (e.g. "Send reminders"), rendered outside the link. */
  cta?: ReactNode;
}

const DOT: Record<AttentionTone, string> = {
  urgent: "bg-rose-50 text-rose-600 ring-rose-100",
  warning: "bg-amber-50 text-amber-600 ring-amber-100",
  info: "bg-violet-50 text-violet-600 ring-violet-100",
};

/**
 * The only part of the dashboard that is allowed to shout.
 *
 * Everything that needs a decision — unpaid invoices, VAT to set aside,
 * expenses awaiting approval, suspected duplicates — lands here as one
 * scannable list instead of four differently-coloured boxes competing for the
 * same attention. Rows are passed in already sorted by urgency; an empty list
 * is a result worth showing, not a blank space.
 */
export function AttentionList({
  items,
  allClearTitle,
  allClearBody,
}: {
  items: AttentionItem[];
  allClearTitle: string;
  allClearBody: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-slate-800">{allClearTitle}</p>
        <p className="max-w-[24ch] text-xs text-slate-500">{allClearBody}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2 pe-3">
          <Link
            href={item.href}
            className="group flex min-w-0 flex-1 items-center gap-3 py-3 ps-5 transition-colors hover:bg-slate-50/80"
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1",
                DOT[item.tone],
              )}
            >
              {item.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-slate-800">
                {item.title}
              </span>
              {item.meta ? (
                <span className="truncate text-xs text-slate-500">{item.meta}</span>
              ) : null}
            </span>
            {item.cta ? null : (
              <ChevronRight
                className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-violet-600 rtl:rotate-180"
                aria-hidden
              />
            )}
          </Link>
          {item.cta ? <div className="shrink-0">{item.cta}</div> : null}
        </li>
      ))}
    </ul>
  );
}
