/**
 * General field extraction from raw PDF text using regex and heuristics.
 * Handles both Hebrew and English invoices with Israeli conventions.
 */

import type { ExtractedInvoiceData } from '@/types/invoice';
import { extractAllDates, normalizeHebrewText } from './hebrew-parser';

// Israeli VAT rate
const ISRAEL_VAT_RATE = 0.18;
const VAT_TOLERANCE = 0.02; // Allow 2% tolerance when checking VAT calculations

/**
 * Parse invoice fields from raw text using regex patterns and heuristics.
 */
export function parseInvoiceFields(text: string): ExtractedInvoiceData {
  const normalized = normalizeHebrewText(text);

  const amount = extractAmount(normalized);
  const currency = extractCurrency(normalized);
  const vatAmount = extractVat(normalized, amount);
  const amountWithoutVat = calculateAmountWithoutVat(amount, vatAmount);
  const invoiceDate = extractDate(normalized);
  const invoiceNumber = extractInvoiceNumber(normalized);
  const vendorName = extractVendorName(normalized);
  const description = extractDescription(normalized);

  return {
    invoiceDate,
    vendorName,
    amount,
    currency,
    amountUsd: null,
    vatAmount,
    amountWithoutVat,
    invoiceNumber,
    description,
    // Heuristic regex pre-pass can't classify intent — leave to the LLM
    // overlay (`mergeExtractionData` keeps explicit overrides on top).
    expenseCategory: null,
    isFixedAsset: false,
  };
}

/**
 * Extract the total amount from the text.
 * Looks for Hebrew/English total keywords near numbers.
 */
function extractAmount(text: string): number | null {
  // Keywords that indicate a total amount, ordered by specificity
  const totalKeywords = [
    'סה"כ לתשלום',
    'סה״כ לתשלום',
    'סה"כ',
    'סה״כ',
    'סכום לתשלום',
    'לתשלום',
    'סכום',
    'total amount',
    'total due',
    'amount due',
    'total',
    'amount',
    'grand total',
  ];

  for (const keyword of totalKeywords) {
    const amount = findAmountNearKeyword(text, keyword);
    if (amount !== null) {
      return amount;
    }
  }

  // Fallback: find the largest number that looks like a monetary amount
  const amounts = findAllMonetaryAmounts(text);
  if (amounts.length > 0) {
    // Return the largest amount as a best guess for the total
    return Math.max(...amounts);
  }

  return null;
}

/**
 * Find a monetary amount within ~50 characters after a keyword.
 */
function findAmountNearKeyword(text: string, keyword: string): number | null {
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Look for the keyword followed by a number within ~50 chars
  const pattern = new RegExp(
    `${escapedKeyword}[^\\d]{0,50}?([\\d,.]+(\\.[\\d]{1,2})?)`,
    'gi'
  );

  const match = pattern.exec(text);
  if (match) {
    return parseMonetaryNumber(match[1]);
  }

  // Also check for number before keyword (common in Hebrew RTL context)
  const reversedPattern = new RegExp(
    `([\\d,.]+(\\.[\\d]{1,2})?)\\s{0,10}${escapedKeyword}`,
    'gi'
  );
  const reverseMatch = reversedPattern.exec(text);
  if (reverseMatch) {
    return parseMonetaryNumber(reverseMatch[1]);
  }

  return null;
}

/**
 * Parse a monetary number string, handling both:
 * - 1,234.56 (US/Israel standard)
 * - 1.234,56 (European)
 */
function parseMonetaryNumber(str: string): number | null {
  if (!str) return null;

  let cleaned = str.trim();

  // Determine format by looking at the last separator
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    // European format: 1.234,56 -> comma is decimal separator
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Standard format: 1,234.56 -> dot is decimal separator
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Find all monetary amounts in the text.
 */
function findAllMonetaryAmounts(text: string): number[] {
  const amounts: number[] = [];
  // Match numbers with optional thousands separators and decimal places
  const pattern = /(?:[\u20AA$\u20AC])\s?(\d[\d,.]*\d)|\b(\d[\d,.]*\d)\s?(?:[\u20AA$\u20AC]|ILS|USD|EUR|NIS)\b/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const numStr = match[1] || match[2];
    const amount = parseMonetaryNumber(numStr);
    if (amount !== null && amount > 0) {
      amounts.push(amount);
    }
  }

  return amounts;
}

/**
 * Extract VAT amount from text.
 */
function extractVat(text: string, totalAmount: number | null): number | null {
  const vatKeywords = ['מע"מ', 'מע״מ', 'מס ערך מוסף', 'vat', 'tax', 'V.A.T'];

  for (const keyword of vatKeywords) {
    const vatAmount = findAmountNearKeyword(text, keyword);
    if (vatAmount !== null) {
      // Ignore bogus matches (e.g. "tax" near an ID / reference larger than the total).
      if (
        totalAmount !== null &&
        (vatAmount > totalAmount || vatAmount > totalAmount * 0.45)
      ) {
        continue;
      }
      return vatAmount;
    }
  }

  // Heuristic: if we have a total, look for a number that's approximately 18% of it
  if (totalAmount !== null) {
    const expectedVat = totalAmount * ISRAEL_VAT_RATE / (1 + ISRAEL_VAT_RATE);
    const amounts = findAllMonetaryAmounts(text);

    for (const amount of amounts) {
      if (amount !== totalAmount) {
        const ratio = amount / totalAmount;
        const expectedRatio = ISRAEL_VAT_RATE / (1 + ISRAEL_VAT_RATE);
        if (Math.abs(ratio - expectedRatio) < VAT_TOLERANCE) {
          return amount;
        }
      }
    }

    // Also check for a "before VAT" amount and derive VAT from it
    const beforeVatKeywords = ['לפני מע"מ', 'לפני מע״מ', 'before vat', 'excl. vat', 'סכום ללא מע"מ'];
    for (const keyword of beforeVatKeywords) {
      const beforeVat = findAmountNearKeyword(text, keyword);
      if (beforeVat !== null) {
        const derivedVat = Math.round((totalAmount - beforeVat) * 100) / 100;
        if (derivedVat > 0) {
          return derivedVat;
        }
      }
    }
  }

  return null;
}

/**
 * Calculate amount without VAT if we have both total and VAT.
 */
function calculateAmountWithoutVat(
  amount: number | null,
  vatAmount: number | null
): number | null {
  if (amount !== null && vatAmount !== null) {
    return Math.round((amount - vatAmount) * 100) / 100;
  }
  return null;
}

/**
 * Extract date from text, preferring dates labeled with date-related keywords.
 */
function extractDate(text: string): string | null {
  const allDates = extractAllDates(text);
  if (allDates.length === 0) return null;
  if (allDates.length === 1) return allDates[0];

  // Look for date near a date label keyword
  const dateKeywords = ['תאריך חשבונית', 'תאריך', 'invoice date', 'date'];
  for (const keyword of dateKeywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `${escapedKeyword}[:\\s]{0,10}(\\d{1,2}[/.\\\-]\\d{1,2}[/.\\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`,
      'gi'
    );
    const match = pattern.exec(text);
    if (match) {
      const nearbyDates = extractAllDates(match[1]);
      if (nearbyDates.length > 0) {
        return nearbyDates[0];
      }
    }
  }

  // If ambiguous, return the latest date (most likely the invoice date)
  return allDates.sort().reverse()[0];
}

/**
 * Extract currency from text context.
 */
function extractCurrency(text: string): string | null {
  // Check for currency symbols and codes
  if (/[\u20AA]|ILS|NIS|ש"ח|ש״ח/.test(text)) return 'ILS';
  if (/\$|USD/.test(text)) return 'USD';
  if (/[\u20AC]|EUR/.test(text)) return 'EUR';

  // Default to ILS for Hebrew-heavy text (Israeli invoices)
  const hebrewChars = (text.match(/[\u0590-\u05FF]/g) || []).length;
  if (hebrewChars > 20) return 'ILS';

  return null;
}

/**
 * Extract invoice number.
 */
function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    // Standard: keyword then number (correct Unicode logical order for Hebrew).
    // \s+ covers tab-separated "חשבונית מס\t656114" produced by Israeli accounting software.
    /חשבונית\s+מס['\u0027\u05F3]?\s*(?:מספר|מס['\u0027\u05F3]?)?\s*[:#]?\s*(\d[\d\-\/]*\d)/i,
    /חשבונית\s*מס['\u0027\u05F3]?\s*(?:מספר|מס['\u0027\u05F3]?)?\s*[:#]?\s*(\d[\d\-\/]*\d)/i,
    /מספר\s*חשבונית\s*[:#]?\s*(\d[\d\-\/]*\d)/i,
    /חשבונית\s*(?:מס['\u0027\u05F3]?)?\s*[:#]?\s*(\d[\d\-\/]*\d)/i,
    /invoice\s*(?:#|no\.?|number)\s*[:#]?\s*([A-Za-z0-9][\w\-\/]*[A-Za-z0-9])/i,
    /inv\s*[#.:]\s*([A-Za-z0-9][\w\-\/]*)/i,
    // Fallback: number appears before keyword (visual LTR order from some PDFs).
    /(\d[\d\-\/]{3,}\d)\s*[:#]?\s*מס['\u0027\u05F3]?\s*חשבונית/i,
    /(\d[\d\-\/]{3,}\d)\s*חשבונית/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * When structured extraction did not find a vendor line, use the first plausible
 * header line (same heuristic as extractVendorName fallback). Pass **layout-preserved**
 * text from `text-extractor.ts` (or raw flat text when layout is empty).
 */
/** Lines that are not vendor letterhead (PDF metadata / invoice boilerplate). */
function isBoilerplateHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^page\s+\d+\s+of\s+\d+/i.test(t)) return true;
  if (/^invoice\s*$/i.test(t)) return true;
  if (/^invoice\s+(number|invoice|#)/i.test(t)) return true;
  if (/^date\s+of\s+(issue|invoice)/i.test(t)) return true;
  if (/^date\s+due/i.test(t)) return true;
  if (/^total\s*$/i.test(t)) return true;
  return false;
}

/**
 * Detect lines that clearly come from the **customer block** of a Hebrew
 * invoice and should never be returned as the vendor label.
 *
 * Signals:
 *   - "לכבוד" anywhere — the "To:" / recipient marker, always sits in or
 *     near the customer column.
 *   - A label-colon pattern adjacent to a value, e.g. "ע.מ:", "ח.פ:",
 *     "כתובת:", "ת.ז:", "טל:". Standalone "ע.מ" without a trailing colon
 *     usually belongs to the supplier letterhead and is allowed through.
 *
 * Note: this runs on **layout-preserved** rows (each row was split on
 * wide whitespace upstream), so a label and its value stay on the same
 * segment.
 */
function isCustomerBlockLine(line: string): boolean {
  if (/לכבוד/.test(line)) return true;
  // Explicit customer VAT line on periodic telecom bills (חשבשבת-style).
  if (/\)לקוח\(|\(לקוח\)/.test(line)) return true;
  // Hebrew label-colon patterns. The colon is the disambiguator — the
  // recipient block uses `ע.מ:` / `כתובת:` to label values, while the
  // supplier block typically writes its own VAT id without a trailing colon.
  if (/(?:^|[\s])(?:ע[.\u05F3'״"]?\s*מ|ח[.\u05F3'״"]?\s*פ|כתובת|ת[.\u05F3'״"]?\s*ז|טל|טלפון|פקס)\s*:/.test(line))
    return true;
  return false;
}

/**
 * True when `line` sits between a "לכבוד" marker and the main invoice
 * metadata block in layout-preserved text. On multi-column Hebrew invoices
 * the recipient name (often `בע"מ`) is on the line *after* לכבוד, not on
 * the same row — so `isCustomerBlockLine` alone is not enough.
 */
export function isWithinLekhovodCustomerZone(
  layoutText: string,
  line: string,
): boolean {
  const t = line.trim();
  if (!t || !layoutText.includes('לכבוד')) return false;
  const start = layoutText.indexOf('לכבוד');
  if (start < 0) return false;

  const tail = layoutText.slice(start);
  const endMarkers = [
    /מס['\u05F3״]?\s*חשבונ/iu,
    /חשבונית\s+תקופתי/iu,
    /\b100\d{9,}\b/,
  ];
  let end = tail.length;
  for (const re of endMarkers) {
    const m = tail.search(re);
    if (m > 0) end = Math.min(end, m);
  }

  const zone = tail.slice(0, end);
  return zone.includes(t);
}

/**
 * Standalone Hebrew accounting labels that never form part of a vendor
 * name. We see them on their own (no value attached) when the layout-aware
 * extractor splits each row on wide whitespace — a label that lived in one
 * column gets isolated from the value that lived in another column.
 */
const STANDALONE_HEBREW_LABELS = new Set<string>([
  'ע.מ',
  'ע"מ',
  'ע״מ',
  'ח.פ',
  'ח"פ',
  'ח״פ',
  'ת.ז',
  'ת"ז',
  'ת״ז',
  'תאריך',
  'שעה',
  'סה"כ',
  'סה״כ',
  'מע"מ',
  'מע״מ',
  'כתובת',
  'טלפון',
  'טל',
  'פקס',
  'חשבונית',
  'חשבונית מס',
  'מספר',
  'מקור',
  'העתק',
  'מנוי',
  'מזהה',
  'מסמך ממוחשב',
]);

/**
 * Reject rows that *look like* a label or a place reference rather than a
 * business name. Catches things the layout-aware pipeline produces when the
 * supplier name isn't in the text layer (logo-only letterheads), e.g.
 * ":מס' הקצאה" (allocation-number label), "רעננה." (a city name from the
 * customer block), or a bare "ע.מ" (the VAT label without its value).
 */
function looksLikeLabelOrPlace(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // Leading colon = a label whose Hebrew-RTL value got reflowed to the
  // wrong side; never a business name.
  if (trimmed.startsWith(':')) return true;
  // Hebrew "מס'" / "מס׳" abbreviation introduces a number label
  // ("number ..."). Not a vendor identifier.
  if (/^מס[\u05F3'״"]/.test(trimmed)) return true;
  // Single Hebrew word ending in a period is almost always a place /
  // city abbreviation (e.g. "רעננה.", "ת"א.") — not a company name.
  if (/^[\u0590-\u05FF]{2,}\.$/.test(trimmed)) return true;
  // Strip decorative wrappers ("==", "--", "**", "..") before checking
  // against the label set — Hebrew accounting boilerplate is often
  // surrounded by "=" or "*" characters (e.g. "==מסמך ממוחשב==").
  const stripped = trimmed.replace(/^[=*\-.\s]+|[=*\-.\s]+$/g, '');
  if (STANDALONE_HEBREW_LABELS.has(stripped)) return true;
  return false;
}

/**
 * `extractVendorNameFallbackLine` is run on the **layout-preserved** text
 * from `text-extractor.ts`, where wide whitespace inside a row marks a
 * column boundary on the original page. We split each row on
 * `≥ 3 spaces` first so a left-column label and a right-column value
 * don't get conflated. We also reject the recipient block, own-business
 * names, and label / place rows.
 */
export function extractVendorNameFallbackLine(
  layoutText: string,
  /**
   * Names belonging to the account owner (own company + income-source
   * vendors). Lines containing any of these names are rejected — they're
   * the *customer* on every invoice the owner uploads, never the supplier.
   */
  ownBusinessNames: string[] = [],
): string | null {
  const header = layoutText.substring(0, 4000);
  const lines = header
    .split('\n')
    // Split each row on wide whitespace so two distant columns aren't
    // merged into a single candidate. 3+ spaces is a strong column-gap
    // signal in our layout text; tighter than that and we'd break normal
    // wording.
    .flatMap((row) => row.split(/\s{3,}/))
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const isSkippable = (line: string) => /^[\d/.\-\s:]+$/.test(line);

  const cleanedOwnNames = ownBusinessNames
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length >= 2);
  const containsOwnName = (line: string): boolean => {
    if (cleanedOwnNames.length === 0) return false;
    const lower = line.toLowerCase();
    return cleanedOwnNames.some((n) => lower.includes(n));
  };

  // Require an unambiguous business-name signal: a recognised legal-form
  // suffix (`בע"מ`, Ltd., Inc., LLC, GmbH, etc.). Anything weaker invents
  // a vendor label out of dates, table headers, or city names whenever the
  // supplier letterhead is image-only — exactly what the previous loose
  // heuristic produced on Israeli חשבשבת invoices with logo-only headers.
  //
  // This fallback only fires when the LLM has already returned `null` for
  // vendorName. A vendor without a legal suffix in its name is precisely
  // the case the LLM is better at, so requiring the suffix here doesn't
  // give up much — and it keeps us from making up garbage labels.
  const BUSINESS_SUFFIX_RE =
    /(?:בע["״']מ|\bLtd\.?\b|\bInc\.?\b|\bLLC\b|\bCorp\.?\b|\bGmbH\b|\bPBC\b|\bPLC\b|\bSARL\b)/i;
  const looksLikeBusinessName = (line: string): boolean =>
    BUSINESS_SUFFIX_RE.test(line);

  /** Prefer short lines; for long letterhead lines take first segment or truncate. */
  const pickFromLine = (line: string): string | null => {
    if (line.length < 3 || isSkippable(line) || isBoilerplateHeaderLine(line))
      return null;
    if (isCustomerBlockLine(line)) return null;
    if (isWithinLekhovodCustomerZone(layoutText, line)) return null;
    if (looksLikeLabelOrPlace(line)) return null;
    if (containsOwnName(line)) return null;
    if (!looksLikeBusinessName(line)) return null;
    if (line.length <= 80) return line;
    const beforeComma = line.split(',')[0]?.trim() ?? '';
    if (beforeComma.length >= 3 && beforeComma.length <= 80) return beforeComma;
    if (beforeComma.length > 80) return beforeComma.slice(0, 80).trim();
    return line.slice(0, 80).trim();
  };

  for (const line of lines) {
    const picked = pickFromLine(line);
    if (picked) return picked;
  }

  return null;
}

/**
 * True when `value` is the kind of **Hebrew street / premises** line we use
 * as a last-resort vendor label when the PDF has no supplier `בע"מ` in the
 * text layer (see `extractVendorFooterAddressFallbackLine`). Used to decide
 * when to run a **vision supplement** on an otherwise text-based PDF — the
 * issuer's legal name may be drawn as outlines next to this address on the
 * rendered page even though it never appears in `getTextContent()`.
 */
export function isFooterStreetAddressVendorLabel(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const t = value.trim();
  if (t.length < 12 || t.length > 160) return false;
  return (
    /^רח\.?\s/u.test(t) ||
    /^רחוב\s/u.test(t) ||
    /^שד['\u05F3"״]?\s/u.test(t) ||
    /^שדרות\s/u.test(t)
  );
}

/**
 * When the supplier's **legal name** is missing from the PDF text layer
 * (logo-only letterhead) but the **issuer footer** still prints a street
 * address (`רח. …`, `רחוב …`, `שדרות …`), use that line as the suggested
 * vendor label so pending invoices are searchable and the user sees a
 * meaningful hint instead of "vendor not found".
 *
 * Scans **from the bottom** of `layoutText` (or flat text when the layout
 * is empty). Skips customer-block lines and any line containing an
 * own-business name.
 */
export function extractVendorFooterAddressFallbackLine(
  layoutOrFlatText: string,
  ownBusinessNames: string[] = [],
): string | null {
  const cleanedOwnNames = ownBusinessNames
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length >= 2);
  const containsOwnName = (line: string): boolean => {
    if (cleanedOwnNames.length === 0) return false;
    const lower = line.toLowerCase();
    return cleanedOwnNames.some((n) => lower.includes(n));
  };

  const lines = layoutOrFlatText
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (isBoilerplateHeaderLine(line)) continue;
    if (isCustomerBlockLine(line)) continue;
    if (containsOwnName(line)) continue;
    if (/^[\d/.\-\s:]+$/.test(line)) continue;
    if (!isFooterStreetAddressVendorLabel(line)) continue;
    return line.slice(0, 120).trim();
  }

  // One-line PDFs: the flat glyph stream often ends with
  // `… Page 1 of 1 רח. שמירה …` — no newline before the footer.
  const tail = layoutOrFlatText.slice(-900);
  const m = tail.match(
    /(רח\.?\s[\u0590-\u05FF0-9\s.,\-'"״׳]{10,120}?)(?=\s*$|\s*Page\s+\d)/iu,
  );
  if (m?.[1]) {
    const cand = m[1].trim();
    if (
      cand.length >= 12 &&
      !containsOwnName(cand) &&
      !isCustomerBlockLine(cand) &&
      isFooterStreetAddressVendorLabel(cand)
    ) {
      return cand.slice(0, 120);
    }
  }

  return null;
}

/**
 * One-line PDFs often concatenate "Page 1 of 1 … Anthropic PBC … Bill to …".
 * Pull issuer name from a known legal suffix before line-based heuristics.
 */
function extractCompanyWithLegalSuffix(text: string): string | null {
  const m = text.match(
    /\b([A-Za-z0-9][A-Za-z0-9\s&.'-]{0,55}?\s+(?:PBC|LLC|Ltd\.?|Inc\.?|Corp\.?|PLC|GmbH|SARL))\b/i
  );
  if (m?.[1]) {
    const s = m[1].trim().replace(/\s+/g, ' ');
    if (s.length >= 2 && s.length <= 120) return s;
  }
  return null;
}

/** Truncate a long letterhead line to a usable vendor label (comma / max length). */
function trimLetterheadVendorLine(line: string): string {
  const cleaned = line
    .replace(/[\r\n]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (cleaned.length <= 120) return cleaned;
  const beforeComma = cleaned.split(',')[0]?.trim() ?? '';
  if (beforeComma.length >= 3 && beforeComma.length <= 120) return beforeComma;
  return cleaned.slice(0, 120).trim();
}

/**
 * Extract vendor/business name from the first portion of the text (regex/heuristics only — no LLM).
 * For scanned PDFs, `vision-extractor.ts` uses Claude with a JSON prompt that includes vendorName.
 */
function extractVendorName(text: string): string | null {
  // Header / letterhead often spans more than a few lines (logos, addresses).
  const header = text.substring(0, 4000);

  const fromSuffix = extractCompanyWithLegalSuffix(header);
  if (fromSuffix) return fromSuffix;

  // US/EU/IL company suffixes — PBC (e.g. Anthropic PBC) was missing and letterhead was skipped.
  const businessIndicators = [
    'בע"מ',
    'בע״מ',
    'Ltd',
    'LLC',
    'Inc',
    'Corp',
    'PBC',
    'PLC',
    'GmbH',
    'SARL',
    'עוסק מורשה',
    'ח.פ',
  ];
  const lines = header.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  for (const line of lines) {
    if (isBoilerplateHeaderLine(line)) continue;
    const lineLower = line.toLowerCase();
    for (const indicator of businessIndicators) {
      if (lineLower.includes(indicator.toLowerCase())) {
        const cleaned = trimLetterheadVendorLine(line);
        if (cleaned.length > 2 && cleaned.length <= 200) {
          return cleaned.length > 120 ? cleaned.slice(0, 120).trim() : cleaned;
        }
      }
    }
  }

  return extractVendorNameFallbackLine(text);
}

/**
 * Extract a brief description from the text.
 */
function extractDescription(text: string): string | null {
  // Look for description-related keywords
  const descKeywords = ['תיאור', 'פירוט', 'description', 'details', 'עבור', 'בגין'];

  for (const keyword of descKeywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedKeyword}[:\\s]+(.{5,100})`, 'i');
    const match = pattern.exec(text);
    if (match) {
      return match[1].trim().replace(/\s+/g, ' ');
    }
  }

  return null;
}
