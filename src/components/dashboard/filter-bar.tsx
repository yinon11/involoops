"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The filter row that scopes a dashboard.
 *
 * Two rules, both from watching people use the old panel:
 *
 *   1. **Everything that scopes the page is visible.** The previous version
 *      hid vendors, the custom date range and the VAT toggle behind a 32px
 *      icon with a count badge. A filter you cannot see is a filter nobody
 *      knows changed the numbers they are reading.
 *   2. **Groups are named in plain words.** A bare row of buttons assumes you
 *      already know what they do. "When" and "Who you paid" do not.
 *
 * It is one region above the content it scopes, never inside a chart card, so
 * every stat, chart and table below always agrees on the same slice.
 */
export function FilterBar({
  children,
  trailing,
}: {
  children: ReactNode;
  /** Right-aligned controls: compare, reset. */
  trailing?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-6 sm:gap-y-3">
          {children}
        </div>
        {trailing ? (
          <div className="flex shrink-0 items-center gap-2 lg:pt-5">{trailing}</div>
        ) : null}
      </div>
    </section>
  );
}

/** A named cluster of controls — the label is what makes the row self-explaining. */
export function FilterGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p
        className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
        title={hint}
      >
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A toggle pill. Selected state is a filled brand chip, never colour alone. */
export function FilterChip({
  selected,
  disabled,
  onClick,
  title,
  children,
  className,
}: {
  selected?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent) => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={selected ? true : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? "border-violet-600 bg-violet-600 text-white shadow-sm hover:bg-violet-700"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Bare input styled to sit in the row (dates, search). */
export const filterInputClassName =
  "h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

/**
 * Multi-select shown as a button that says what is selected, plus a panel of
 * checkable rows. Rows, not a calendar grid or a bare listbox — presets and
 * names are what people scan for.
 */
export function MultiSelectFilter({
  buttonLabel,
  selectedCount,
  options,
  selectedIds,
  onToggle,
  onClear,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
}: {
  buttonLabel: string;
  selectedCount: number;
  options: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = options.filter((o) =>
    o.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div ref={wrapRef} className="relative">
      <FilterChip selected={selectedCount > 0} onClick={() => setOpen((v) => !v)}>
        <span className="max-w-[180px] truncate">{buttonLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      </FilterChip>

      {open ? (
        <div className="absolute z-50 mt-1.5 w-[280px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className={`${filterInputClassName} w-full`}
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                {emptyLabel}
              </li>
            ) : (
              shown.map((option) => {
                const checked = selectedIds.includes(option.id);
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={() => onToggle(option.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-violet-600 bg-violet-600 text-white"
                            : "border-slate-300 bg-white",
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span className="truncate">{option.name}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {selectedCount > 0 ? (
            <div className="border-t border-slate-100 p-1.5">
              <button
                type="button"
                onClick={onClear}
                className="flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
                {clearLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
