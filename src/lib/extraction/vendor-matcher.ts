/**
 * Match extracted PDF text against known vendors by name and aliases.
 *
 * Uses normalized text (PDF artifacts, punctuation, spacing) and a multi-word
 * fallback so legal names and invoice letterheads still match.
 */

interface VendorInfo {
  id: string;
  name: string;
  aliases: string[];
  /**
   * When true, this vendor is deprioritized in matching: we only match it if
   * no non-income-source vendor also matches. This avoids false positives from
   * the user's own business name (e.g. a lawyer whose firm appears in the
   * recipient / contact block of every vendor's invoice).
   */
  isIncomeSource?: boolean;
}

interface VendorMatch {
  vendorId: string;
  confidence: number;
}

/** English noise tokens — must not be the only basis for a multi-word match */
const EN_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'for',
  'in',
  'to',
  'at',
  'ltd',
  'inc',
  'corp',
  'llc',
  'co',
]);

/**
 * Normalize for substring / token matching (not for display).
 */
export function normalizeForVendorMatch(s: string): string {
  let t = s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\uFEFF\u200B\u200C\u200D\u200E\u200F]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/["\u201C\u201D\u05F4'״]/g, ' ');
  // Common PDF separators → space
  t = t.replace(/[.,;:!?()[\]{}_/\\-]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function significantTokens(normName: string): string[] {
  return normName
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !EN_STOPWORDS.has(w));
}

/**
 * Longest contiguous match score; 0 if no match.
 */
function matchScore(normText: string, normName: string): number {
  if (normName.length < 2) return 0;

  // Forward: invoice text contains vendor string
  if (normText.includes(normName)) {
    return normName.length;
  }

  // Multi-word: all significant tokens appear somewhere in the text (order-free).
  // Helps when letterhead wraps or punctuation splits the legal name.
  const tokens = significantTokens(normName);
  if (tokens.length >= 2 && tokens.every((tok) => normText.includes(tok))) {
    return normName.length;
  }

  // Single significant token: treat as weak forward match only if token length ≥ 4
  if (tokens.length === 1 && tokens[0].length >= 4 && normText.includes(tokens[0])) {
    return tokens[0].length;
  }

  // Reverse: short extracted label contained in longer DB name (e.g. "Acme" vs "Acme Industries Ltd")
  if (
    normText.length >= 2 &&
    normText.length < normName.length &&
    normName.includes(normText)
  ) {
    return normText.length;
  }

  return 0;
}

const LOG_PREVIEW_LEN = 280;

function preview(s: string, max = LOG_PREVIEW_LEN): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * Scan a single group of vendors and return the best (longest) match in that group,
 * plus its score length for tie-breaking by the caller.
 */
function bestMatchInGroup(
  normText: string,
  group: VendorInfo[]
): { match: VendorMatch; scoreLength: number } | null {
  let bestMatch: VendorMatch | null = null;
  let bestMatchLength = 0;

  for (const vendor of group) {
    const allNames = [vendor.name, ...vendor.aliases];

    for (const name of allNames) {
      const normName = normalizeForVendorMatch(name);
      const matchLength = matchScore(normText, normName);
      if (matchLength === 0) continue;

      const confidence = Math.min(0.5 + matchLength * 0.05, 1.0);

      if (matchLength > bestMatchLength) {
        bestMatchLength = matchLength;
        bestMatch = {
          vendorId: vendor.id,
          confidence,
        };
      }
    }
  }

  if (!bestMatch) return null;
  return { match: bestMatch, scoreLength: bestMatchLength };
}

/**
 * Match the extracted text against a list of known vendors.
 *
 * Two-pass: regular (expense) vendors first, income-source vendors as fallback.
 * Income-source vendors are typically the user's own business — their name
 * appears on almost every invoice as a recipient / contact-info line, so
 * matching them eagerly causes false positives (e.g. a WeWork invoice
 * "matches" the user's own law firm because the firm's name is in the footer).
 * An income-source vendor only wins if no regular vendor matched.
 *
 * Within each pass the longest matching name wins.
 */
export function matchVendor(
  text: string,
  vendors: VendorInfo[]
): VendorMatch | null {
  const normText = normalizeForVendorMatch(text);

  console.log(
    '[vendor-match] Trying to match invoice text to a known vendor (%d vendor(s) in DB).',
    vendors.length
  );
  console.log(
    '[vendor-match] Known vendor names:',
    vendors.length
      ? vendors.map((v) => v.name + (v.aliases?.length ? ` (+${v.aliases.length} alias)` : '')).join(' | ')
      : '(none)'
  );

  if (normText.length < 2) {
    console.log(
      '[vendor-match] Skipping match: normalized text is too short (%d chars).',
      normText.length
    );
    return null;
  }

  console.log(
    '[vendor-match] Normalized text preview (%d chars): %s',
    normText.length,
    preview(normText)
  );

  const regular = vendors.filter((v) => !v.isIncomeSource);
  const incomeSource = vendors.filter((v) => v.isIncomeSource);

  const regularBest = bestMatchInGroup(normText, regular);
  const incomeBest =
    regularBest == null ? bestMatchInGroup(normText, incomeSource) : null;

  if (incomeBest && incomeSource.length > 0 && regular.length > 0) {
    console.log(
      '[vendor-match] No regular vendor matched; falling back to income-source vendors (user\'s own business is last-resort to avoid recipient-info false positives).'
    );
  }

  const chosen = regularBest ?? incomeBest;

  if (chosen && chosen.match.confidence > 0.5) {
    const label = vendors.find((v) => v.id === chosen.match.vendorId)?.name ?? '?';
    console.log(
      '[vendor-match] Matched vendor: id=%s name=%j confidence=%s (score length=%d)',
      chosen.match.vendorId,
      label,
      chosen.match.confidence.toFixed(3),
      chosen.scoreLength
    );
    return chosen.match;
  }

  if (chosen) {
    const label = vendors.find((v) => v.id === chosen.match.vendorId)?.name ?? '?';
    console.log(
      '[vendor-match] Best candidate below confidence threshold: id=%s name=%j confidence=%s — treating as no match.',
      chosen.match.vendorId,
      label,
      chosen.match.confidence.toFixed(3)
    );
  } else {
    console.log(
      '[vendor-match] No vendor row matched. The invoice text may still contain a vendor — see [invoice-extract] "vendor label on invoice" for what we store for pending.'
    );
  }

  return null;
}
