/**
 * Hebrew date parsing and text normalization for Israeli invoices.
 *
 * Handles Hebrew month names, RTL text issues, and various date formats
 * commonly found in Israeli invoices.
 */

const HEBREW_MONTHS: Record<string, number> = {
  'ינואר': 1,
  'פברואר': 2,
  'מרץ': 3,
  'אפריל': 4,
  'מאי': 5,
  'יוני': 6,
  'יולי': 7,
  'אוגוסט': 8,
  'ספטמבר': 9,
  'אוקטובר': 10,
  'נובמבר': 11,
  'דצמבר': 12,
};

const ENGLISH_MONTHS: Record<string, number> = {
  'january': 1,
  'february': 2,
  'march': 3,
  'april': 4,
  'may': 5,
  'june': 6,
  'july': 7,
  'august': 8,
  'september': 9,
  'october': 10,
  'november': 11,
  'december': 12,
  'jan': 1,
  'feb': 2,
  'mar': 3,
  'apr': 4,
  'jun': 6,
  'jul': 7,
  'aug': 8,
  'sep': 9,
  'oct': 10,
  'nov': 11,
  'dec': 12,
};

/**
 * Parse a date string that may be in Hebrew format and return an ISO date string.
 * Tries multiple patterns commonly found in Israeli invoices.
 */
export function parseHebrewDate(text: string): string | null {
  const dates = extractAllDates(text);
  return dates.length > 0 ? dates[0] : null;
}

/**
 * Extract ALL dates found in a text string.
 * Returns an array of ISO date strings (YYYY-MM-DD).
 * Patterns are tried in order of specificity.
 */
export function extractAllDates(text: string): string[] {
  const normalized = normalizeHebrewText(text);
  const found: string[] = [];
  const seen = new Set<string>();

  const addDate = (iso: string) => {
    if (!seen.has(iso) && isValidDate(iso)) {
      seen.add(iso);
      found.push(iso);
    }
  };

  // Pattern 1: DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY (Israeli standard)
  const dmyFullRegex = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/g;
  let match: RegExpExecArray | null;
  while ((match = dmyFullRegex.exec(normalized)) !== null) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      addDate(toIso(year, month, day));
    }
  }

  // Pattern 2: YYYY-MM-DD (ISO format)
  const isoRegex = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((match = isoRegex.exec(normalized)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // Only add if not already captured by pattern 1 (avoid double-counting)
      const iso = toIso(year, month, day);
      addDate(iso);
    }
  }

  // Pattern 3: Hebrew month name patterns: DD בMONTH_NAME YYYY
  for (const [monthName, monthNum] of Object.entries(HEBREW_MONTHS)) {
    // Pattern: DD בMONTH YYYY or DD MONTH YYYY
    const hebrewPattern = new RegExp(
      `(\\d{1,2})\\s*(?:ב)?${escapeRegex(monthName)}\\s*,?\\s*(\\d{4})`,
      'g'
    );
    while ((match = hebrewPattern.exec(normalized)) !== null) {
      const day = parseInt(match[1], 10);
      const year = parseInt(match[2], 10);
      addDate(toIso(year, monthNum, day));
    }
  }

  // Pattern 4: English month patterns
  for (const [monthName, monthNum] of Object.entries(ENGLISH_MONTHS)) {
    // DD Month YYYY
    const enPattern1 = new RegExp(
      `(\\d{1,2})\\s+${escapeRegex(monthName)}\\s*,?\\s*(\\d{4})`,
      'gi'
    );
    while ((match = enPattern1.exec(normalized)) !== null) {
      const day = parseInt(match[1], 10);
      const year = parseInt(match[2], 10);
      addDate(toIso(year, monthNum, day));
    }

    // Month DD, YYYY
    const enPattern2 = new RegExp(
      `${escapeRegex(monthName)}\\s+(\\d{1,2})\\s*,?\\s*(\\d{4})`,
      'gi'
    );
    while ((match = enPattern2.exec(normalized)) !== null) {
      const day = parseInt(match[1], 10);
      const year = parseInt(match[2], 10);
      addDate(toIso(year, monthNum, day));
    }
  }

  // Pattern 5: Short year DD/MM/YY (assume 20xx)
  const dmyShortRegex = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})\b/g;
  while ((match = dmyShortRegex.exec(normalized)) !== null) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const shortYear = parseInt(match[3], 10);
    const year = 2000 + shortYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      addDate(toIso(year, month, day));
    }
  }

  return found;
}

/**
 * Normalize Hebrew text for processing:
 * - Handle RTL reversed chunks
 * - Unicode NFC normalization
 * - Clean common PDF extraction artifacts
 */
export function normalizeHebrewText(text: string): string {
  // Unicode NFC normalization
  let normalized = text.normalize('NFC');

  // Remove common PDF artifacts: BOM, zero-width chars, excessive control chars
  normalized = normalized.replace(/[\uFEFF\u200B\u200C\u200D\u200E\u200F]/g, '');

  // Normalize various quote/geresh characters used in Hebrew abbreviations
  // (e.g., סה"כ vs סה״כ)
  normalized = normalized.replace(/["\u201C\u201D\u05F4]/g, '"');
  normalized = normalized.replace(/['\u2018\u2019\u05F3]/g, "'");

  // Attempt to fix reversed Hebrew chunks from bad PDF extraction.
  // Hebrew text runs right-to-left, but PDF extractors sometimes reverse the
  // character order within a line. We detect lines that start with Hebrew but
  // appear reversed (ending with Hebrew) and reverse them back.
  const lines = normalized.split('\n');
  const fixedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Check if line is predominantly Hebrew
    const hebrewChars = (trimmed.match(/[\u0590-\u05FF]/g) || []).length;
    const totalAlpha = (trimmed.match(/[a-zA-Z\u0590-\u05FF]/g) || []).length;

    if (totalAlpha > 0 && hebrewChars / totalAlpha > 0.5) {
      // Check if the line appears reversed: if splitting by spaces and reversing
      // word order gives a more natural reading (heuristic: check if common
      // Hebrew words appear in the reversed version)
      // We use a simple heuristic: reverse word order for predominantly-Hebrew lines
      // that contain known reversed patterns
      const words = trimmed.split(/\s+/);
      if (words.length > 1 && isLikelyReversed(words)) {
        return words.reverse().join(' ');
      }
    }
    return line;
  });

  normalized = fixedLines.join('\n');

  // Collapse multiple spaces
  normalized = normalized.replace(/ {2,}/g, ' ');

  return normalized;
}

/**
 * Heuristic to detect if Hebrew word order appears reversed.
 *
 * Some PDF extractors output lines in visual left-to-right order instead of
 * Unicode logical order. For Hebrew, a "leading label" word (e.g. חשבונית,
 * תאריך, מספר) should appear at the START of the logical string because it
 * sits on the RIGHT side of the page (start of RTL reading). When such a word
 * appears at the END of the extracted string it was placed last by a visual
 * LTR scan — the line needs to be reversed back to logical order.
 *
 * Importantly, words like בע"מ legitimately terminate company names
 * ("אלצר בע\"מ") and must NOT trigger a reversal.
 */
function isLikelyReversed(words: string[]): boolean {
  // Only labels that introduce a field value — never company-name suffixes.
  const leadingLabels = ['חשבונית', 'מספר', 'תאריך'];

  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  for (const label of leadingLabels) {
    if (lastWord.includes(label) && !firstWord.includes(label)) {
      return true;
    }
  }
  return false;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isValidDate(iso: string): boolean {
  const [yearStr, monthStr, dayStr] = iso.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Check actual day validity for the month
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
