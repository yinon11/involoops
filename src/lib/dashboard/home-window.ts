/**
 * The window the home dashboard is scoped to.
 *
 * Kept out of the filter component: that file is a client module, and a
 * function exported from one cannot run during a server render.
 */

export const HOME_RANGES = [
  "last30",
  "thisMonth",
  "last90",
  "thisYear",
  "last12Months",
  "allTime",
] as const;

export type HomeRange = (typeof HOME_RANGES)[number];

export interface HomeWindow {
  range: HomeRange;
  /** Inclusive start, YYYY-MM-DD. Null means no lower bound. */
  from: string | null;
  /** Exclusive end, YYYY-MM-DD. Null means no upper bound. */
  to: string | null;
  prevFrom: string | null;
  prevTo: string | null;
  /** How the chart buckets the same window. Short windows are one bar a day. */
  grain: "day" | "month";
  /**
   * Chart slots. For the current month the totals cover the whole calendar
   * month, while the bars stop at today so the rest of the month is not a
   * row of empty days.
   */
  chartFrom: string | null;
  chartTo: string | null;
}

export function readHomeRange(
  raw: string | string[] | undefined,
): HomeRange {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (HOME_RANGES as readonly string[]).includes(value ?? "")
    ? (value as HomeRange)
    : "last30";
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Local calendar day, so a UTC shift cannot move the window by a day. */
function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function homeWindow(range: HomeRange, now = new Date()): HomeWindow {
  const today = startOfToday(now);
  const tomorrow = addDays(today, 1);

  if (range === "thisMonth") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const prevFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return {
      range,
      from: ymd(from),
      to: ymd(to),
      prevFrom: ymd(prevFrom),
      prevTo: ymd(from),
      grain: "day",
      chartFrom: ymd(from),
      chartTo: ymd(tomorrow),
    };
  }

  if (range === "last30" || range === "last90") {
    const days = range === "last30" ? 30 : 90;
    const from = addDays(today, -(days - 1));
    const prevFrom = addDays(from, -days);
    const bounds = {
      from: ymd(from),
      to: ymd(tomorrow),
      prevFrom: ymd(prevFrom),
      prevTo: ymd(from),
    };
    return {
      range,
      ...bounds,
      grain: range === "last30" ? "day" : "month",
      chartFrom: bounds.from,
      chartTo: bounds.to,
    };
  }

  if (range === "thisYear") {
    const from = new Date(today.getFullYear(), 0, 1);
    const prevFrom = new Date(today.getFullYear() - 1, 0, 1);
    const prevTo = new Date(
      today.getFullYear() - 1,
      today.getMonth(),
      today.getDate() + 1,
    );
    const fromYmd = ymd(from);
    const toYmd = ymd(tomorrow);
    return {
      range,
      from: fromYmd,
      to: toYmd,
      prevFrom: ymd(prevFrom),
      prevTo: ymd(prevTo),
      grain: "month",
      chartFrom: fromYmd,
      chartTo: toYmd,
    };
  }

  if (range === "last12Months") {
    const from = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const prevFrom = new Date(today.getFullYear(), today.getMonth() - 23, 1);
    const fromYmd = ymd(from);
    const toYmd = ymd(to);
    return {
      range,
      from: fromYmd,
      to: toYmd,
      prevFrom: ymd(prevFrom),
      prevTo: fromYmd,
      grain: "month",
      chartFrom: fromYmd,
      chartTo: toYmd,
    };
  }

  return {
    range: "allTime",
    from: null,
    to: null,
    prevFrom: null,
    prevTo: null,
    grain: "month",
    chartFrom: null,
    chartTo: null,
  };
}

export function parseYmd(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Every chart slot in the window, oldest first. All-time has no fixed slots. */
export function chartSlots(window: HomeWindow): string[] {
  if (!window.chartFrom || !window.chartTo) return [];
  const end = parseYmd(window.chartTo);
  const start = parseYmd(window.chartFrom);
  if (window.grain === "day") {
    const slots: string[] = [];
    for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
      slots.push(ymd(cursor));
    }
    return slots;
  }
  const slots: string[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < end) {
    slots.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
    );
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return slots;
}
