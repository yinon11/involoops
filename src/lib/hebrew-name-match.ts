const FINAL_FORMS: Record<string, string> = {
  ך: "כ",
  ם: "מ",
  ן: "נ",
  ף: "פ",
  ץ: "צ",
};

/** Strip nikud, punctuation, and final-letter forms so STT near-misses can match. */
export function foldHebrewName(value: string): string {
  return value
    .replace(/[ךםןףץ]/g, (c) => FINAL_FORMS[c] || c)
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[^\u05D0-\u05EAa-z0-9]/gi, "")
    .toLowerCase();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

function nameCandidates(haystack: string): string[] {
  const folded = foldHebrewName(haystack);
  const tokens = haystack
    .split(/\s+/)
    .map(foldHebrewName)
    .filter((token) => token.length >= 2);
  return Array.from(new Set([folded, ...tokens].filter(Boolean)));
}

export function hebrewNameDistance(haystack: string, spoken: string): number {
  const n = foldHebrewName(spoken);
  if (!n) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of nameCandidates(haystack)) {
    if (candidate === n) return 0;
    if (n.length >= 3 && candidate.includes(n)) return 0;
    best = Math.min(best, levenshtein(candidate, n));
  }
  return best;
}

/** True when spoken STT is the same name or a one/two-letter miss (אלתר vs אלצר). */
export function hebrewNamesClose(haystack: string, spoken: string): boolean {
  const n = foldHebrewName(spoken);
  if (!n) return false;
  for (const candidate of nameCandidates(haystack)) {
    if (candidate === n) return true;
    if (n.length >= 3 && candidate.includes(n)) return true;
    const dist = levenshtein(candidate, n);
    const maxLen = Math.max(candidate.length, n.length);
    if (maxLen <= 5 && dist <= 1) return true;
    if (maxLen > 5 && dist <= 2) return true;
  }
  return false;
}

export function bestHebrewNameMatch<T>(
  items: T[],
  spoken: string,
  textOf: (item: T) => string,
): T | null {
  const needle = spoken.trim().toLowerCase();
  if (!needle) return null;
  const exact =
    items.find((item) => textOf(item).trim().toLowerCase() === needle) ||
    items.find((item) => textOf(item).toLowerCase().includes(needle));
  if (exact) return exact;

  const scored = items
    .map((item) => ({ item, dist: hebrewNameDistance(textOf(item), spoken) }))
    .filter(({ item }) => hebrewNamesClose(textOf(item), spoken))
    .sort((a, b) => a.dist - b.dist);
  return scored[0]?.item ?? null;
}
