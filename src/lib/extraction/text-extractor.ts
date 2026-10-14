import { getDocumentProxy } from 'unpdf';
import type { TextExtractionResult } from '@/types/extraction';

/**
 * Extract text content from a PDF buffer using unpdf / PDF.js.
 *
 * Returns two text views of every page:
 *   - `text`        — flat (space-joined) glyph stream. Cheap; good for regex.
 *   - `layoutText`  — RTL-friendly layout reconstruction with rows + x
 *                     spacing preserved. Sent to the LLM so it can tell
 *                     left and right columns apart in multi-column
 *                     Hebrew invoices (the customer block on the right
 *                     was previously merged into the same line as the
 *                     vendor block on the left, causing the LLM to mis-pick
 *                     the customer name as `vendorName`).
 *
 * If positional reconstruction fails for any reason we fall back to the
 * flat text in both fields so the rest of the pipeline keeps working.
 */
export async function extractTextFromPdf(
  buffer: Buffer
): Promise<TextExtractionResult> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const totalPages = pdf.numPages;

    const flatPages: string[] = [];
    const layoutPages: string[] = [];

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();

      const { flat, layout } = pageTextViews(
        // PDF.js text item shape — narrowed inline since pdfjs types are
        // re-exported through unpdf and importing them adds a hard
        // pdfjs-dist dependency we don't otherwise need.
        tc.items as readonly UnknownTextItem[],
        viewport.width,
      );
      flatPages.push(flat);
      layoutPages.push(layout);
    }

    const flatText = flatPages.join('\n');
    const layoutText = layoutPages.join('\n\n');
    const isTextBased = checkTextQuality(flatText);

    return {
      text: flatText,
      // Use flat text when reconstruction produced no rows (e.g. PDF was
      // image-only / vision will run anyway).
      layoutText: layoutText.trim().length > 0 ? layoutText : flatText,
      pageCount: totalPages,
      isTextBased,
    };
  } catch (error) {
    console.error('PDF text extraction failed:', error);
    return {
      text: '',
      layoutText: '',
      pageCount: 0,
      isTextBased: false,
    };
  }
}

/**
 * Check if extracted text is meaningful (not just gibberish from a scanned PDF).
 * Requires > 50 chars and meaningful alphanumeric or Hebrew characters.
 */
function checkTextQuality(text: string): boolean {
  if (text.length <= 50) {
    return false;
  }

  // Count meaningful characters: alphanumeric, Hebrew (U+0590-U+05FF)
  const meaningfulChars = text.match(/[a-zA-Z0-9\u0590-\u05FF]/g);
  if (!meaningfulChars || meaningfulChars.length < 20) {
    return false;
  }

  return true;
}

/**
 * Minimal shape we rely on from PDF.js' TextItem. PDF.js also emits
 * TextMarkedContent items (no `str`); those are skipped.
 */
interface UnknownTextItem {
  str?: string;
  /** [a, b, c, d, e, f] — `e` is x, `f` is y in PDF user units. */
  transform?: readonly number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface PageTextViews {
  flat: string;
  layout: string;
}

/**
 * Build both views for a single page.
 *
 * Algorithm for `layout`:
 *   1. Drop items without a string / position; ignore pure-whitespace.
 *   2. Group items into rows by y, using ~60% of the smallest glyph
 *      height as tolerance. PDF y increases upward, so sort rows top
 *      to bottom by y DESC.
 *   3. Inside each row, sort items by x ASC. We deliberately map PDF
 *      x linearly to output columns (LTR). Hebrew glyphs inside each
 *      string remain in logical/Unicode order — Hebrew text is RTL on
 *      paper but every text item is a contiguous unit, so the LLM
 *      gets the same codepoint sequence pdf.js produced.
 *   4. Pad with spaces so each item starts near its real x position.
 *      Always insert at least one space between items; this gives the
 *      LLM a clear "column gap" cue when two items are far apart on
 *      the page.
 *
 * 120 character columns across the page width is a good compromise:
 *   - wide enough to keep distinct columns separated (a typical
 *     A4 invoice has 2-3 logical columns ≈ 30-40 chars each),
 *   - narrow enough that prompts stay compact.
 */
function pageTextViews(
  items: readonly UnknownTextItem[],
  pageWidth: number,
): PageTextViews {
  const normalized: NormalizedItem[] = [];
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    if (it.str.trim().length === 0) continue;
    const t = it.transform;
    if (!t || t.length < 6) continue;
    const x = Number(t[4]);
    const y = Number(t[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    normalized.push({
      x,
      y,
      w: Number.isFinite(it.width) ? Number(it.width) : 0,
      h: Number.isFinite(it.height) && Number(it.height) > 0 ? Number(it.height) : 9,
      str: it.str,
    });
  }

  if (normalized.length === 0) {
    return { flat: '', layout: '' };
  }

  const flat = normalized.map((n) => n.str).join(' ');

  // Effective line height: smallest non-trivial glyph height. Fall back
  // to 9 (a typical 9pt font height in PDF user units) when missing.
  const heights = normalized.map((n) => n.h).filter((h) => h >= 5);
  const lineH = heights.length > 0 ? Math.min(...heights) : 9;
  const yTol = Math.max(lineH * 0.6, 4);

  const byY = [...normalized].sort((a, b) => b.y - a.y);
  const rows: NormalizedItem[][] = [];
  let current: NormalizedItem[] = [byY[0]];
  let currentY = byY[0].y;
  for (let i = 1; i < byY.length; i++) {
    const it = byY[i];
    if (Math.abs(it.y - currentY) <= yTol) {
      current.push(it);
    } else {
      rows.push(current);
      current = [it];
      currentY = it.y;
    }
  }
  rows.push(current);

  const COLS = 120;
  const safePageWidth = pageWidth > 0 ? pageWidth : 595; // A4 width fallback.
  const charWidth = safePageWidth / COLS;

  const layoutLines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = '';
    for (const it of row) {
      const targetCol = Math.max(0, Math.round(it.x / charWidth));
      if (line.length < targetCol) {
        line += ' '.repeat(targetCol - line.length);
      } else if (line.length > 0 && !line.endsWith(' ')) {
        line += ' ';
      }
      line += it.str;
    }
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed.length > 0) {
      layoutLines.push(trimmed);
    }
  }

  return { flat, layout: layoutLines.join('\n') };
}

interface NormalizedItem {
  x: number;
  y: number;
  w: number;
  h: number;
  str: string;
}
