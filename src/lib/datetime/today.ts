/**
 * Calendar-day helpers for Israel time.
 *
 * Document dates (invoice / issue / payment dates) are Israeli tax-document
 * dates and must follow the local calendar day, NOT UTC. Using
 * `new Date().toISOString().slice(0, 10)` silently rolls the date back to
 * "yesterday" whenever the call happens after midnight Israel time but
 * before midnight UTC (i.e. 00:00–02:00/03:00 local), which produces an
 * issue date that can fall before the payment date entered the same evening.
 *
 * `Asia/Jerusalem` matches the cadence used elsewhere (see the FX rate cache
 * `jerusalemDay`), and is the legally-correct civil day for an Israeli
 * business document regardless of where the user's browser happens to be.
 */

const ISRAEL_TZ = "Asia/Jerusalem";

/** `YYYY-MM-DD` for the given instant on the Israel civil calendar. */
export function israelDateString(d: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD, so no manual reordering is needed.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Today's date (`YYYY-MM-DD`) on the Israel civil calendar. */
export function todayInIsrael(): string {
  return israelDateString(new Date());
}

/**
 * Israel's UTC offset in milliseconds at a given instant (+2h IST / +3h IDT).
 *
 * Derived by reading the same instant through `Asia/Jerusalem` and diffing
 * against UTC, so it needs no DST table and follows any future rule change.
 */
function israelOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const part = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const localAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    // Some ICU versions render midnight as hour 24 under hour12:false.
    part("hour") % 24,
    part("minute"),
    part("second"),
  );
  // `localAsUtc` carries no milliseconds, so compare against a whole second.
  return localAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the Israel civil day containing `now` began.
 *
 * Use this for "since the start of today" range queries — comparing against a
 * UTC-truncated day would shift the window by the Israel offset, so documents
 * from 00:00-03:00 local would land in the wrong day.
 *
 * Resolved in two passes: take local midnight as a naive UTC timestamp, shift
 * it by the offset in effect nearby, then re-check the offset AT that instant
 * and redo the shift if the first guess straddled a DST boundary. Subtracting
 * the elapsed local wall-clock time instead would be wrong on both transition
 * days — elapsed local time and elapsed real time differ by an hour.
 */
export function startOfIsraelDay(now: Date = new Date()): Date {
  const [year, month, day] = israelDateString(now).split("-").map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

  const firstGuessOffset = israelOffsetMs(new Date(localMidnightAsUtc));
  let startMs = localMidnightAsUtc - firstGuessOffset;

  const offsetAtStart = israelOffsetMs(new Date(startMs));
  if (offsetAtStart !== firstGuessOffset) {
    startMs = localMidnightAsUtc - offsetAtStart;
  }

  return new Date(startMs);
}
