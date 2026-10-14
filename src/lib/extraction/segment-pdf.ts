/**
 * Segment a multi-page PDF into per-invoice sub-PDFs.
 *
 * Used by the pending-queue "Split into separate invoices" button when a
 * user uploaded a single file containing receipts for several different
 * vendors (e.g. a batch scan). We ask a cheap LLM (Haiku) which page ranges
 * belong to the same invoice, then materialize each range into its own PDF
 * buffer so the existing extraction pipeline can process each segment as if
 * it were an independent upload.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getDocumentProxy, extractText } from "unpdf";
import { PDFDocument } from "pdf-lib";
import type { LlmTokenUsage } from "@/types/invoice";
import { getSegmentationModel } from "./anthropic-models";

export interface PerPageText {
  pageNumber: number;
  text: string;
}

export interface InvoiceSegment {
  /** 1-indexed page numbers that make up a single invoice. */
  pages: number[];
  /** Human hint (e.g. vendor name / number) from the LLM, used in logs. */
  hint: string | null;
}

export interface SegmentationResult {
  segments: InvoiceSegment[];
  usage: LlmTokenUsage;
}

/** Haiku pricing (USD per token) — kept local to avoid conflating with Sonnet pricing in llm-cost.ts. */
const HAIKU_INPUT_COST_PER_TOKEN = 0.8 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4 / 1_000_000;

function calculateHaikuCost(
  inputTokens: number,
  outputTokens: number
): LlmTokenUsage {
  const costUsd =
    inputTokens * HAIKU_INPUT_COST_PER_TOKEN +
    outputTokens * HAIKU_OUTPUT_COST_PER_TOKEN;
  return { inputTokens, outputTokens, costUsd };
}

/**
 * Extract text page-by-page from a PDF buffer. Unlike `extractTextFromPdf`,
 * this preserves page boundaries so segmentation can reason about which
 * page each piece of text belongs to.
 */
export async function extractPerPageText(
  buffer: Buffer
): Promise<{ pageCount: number; pages: PerPageText[] }> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages: PerPageText[] = (Array.isArray(text) ? text : [text]).map(
    (t, i) => ({ pageNumber: i + 1, text: typeof t === "string" ? t : "" })
  );
  return { pageCount: totalPages, pages };
}

const MAX_PAGE_TEXT_CHARS = 2_000;

function buildSegmentationPrompt(pages: PerPageText[]): string {
  const pageBlocks = pages
    .map((p) => {
      const snippet =
        p.text.length > MAX_PAGE_TEXT_CHARS
          ? p.text.slice(0, MAX_PAGE_TEXT_CHARS) + "\n[... truncated ...]"
          : p.text;
      return `=== PAGE ${p.pageNumber} ===\n${snippet.trim() || "(no text extracted — likely scanned/image page)"}`;
    })
    .join("\n\n");

  return `You are given the text of every page in a single PDF. The PDF may contain one invoice spanning several pages, or several unrelated invoices concatenated together (e.g. a batch scan of different receipts), or a mix (invoice + terms page).

Group the pages into one or more invoices. Rules:
- Each group must be a set of 1-indexed page numbers that belong to the SAME invoice.
- A page may appear in at most one group.
- Pages that are clearly not invoices (blank, scanner covers, unrelated documents) can be omitted from all groups.
- Continuation pages of the same invoice (terms & conditions, itemized back-side, "page 2 of 2" markers) stay with their main page.
- Different vendor names, different invoice numbers, or different totals on different pages are strong signals that the pages belong to different invoices.
- If you are not sure, prefer FEWER groups (keep adjacent pages together) rather than over-splitting.

Return ONLY a JSON array, no other text, in this exact shape:
[
  { "pages": [1, 2], "hint": "Steve Madden receipt" },
  { "pages": [3], "hint": "Rogovin 32" }
]

If the whole PDF is a single invoice, return a single-element array that lists every relevant page.

Pages:
${pageBlocks}`;
}

/** Total char count across all per-page text. Scanned/image PDFs sit near 0. */
function totalTextChars(pages: PerPageText[]): number {
  return pages.reduce((sum, p) => sum + p.text.trim().length, 0);
}

/**
 * Call Claude Haiku with the per-page plain text. Returns [] if the model
 * itself could not group the pages (e.g. empty text on scanned pages).
 */
async function segmentFromText(
  client: Anthropic,
  pages: PerPageText[]
): Promise<SegmentationResult> {
  const prompt = buildSegmentationPrompt(pages);
  const response = await client.messages.create({
    model: getSegmentationModel(),
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const usage = calculateHaikuCost(
    response.usage.input_tokens,
    response.usage.output_tokens
  );

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { segments: [], usage };
  }

  const raw = textBlock.text;
  console.warn(
    "[invoice-split] Haiku text segmentation raw response:\n%s\n(tokens: %d in / %d out, $%s)",
    raw,
    usage.inputTokens,
    usage.outputTokens,
    usage.costUsd.toFixed(6)
  );

  return { segments: parseSegmentsFromLlmResponse(raw, pages.length), usage };
}

function buildVisionSegmentationPrompt(pageCount: number): string {
  return `You are shown a PDF that contains ${pageCount} page(s). It may be a single invoice, several unrelated invoices concatenated together (e.g. a batch scan of different receipts), or a mix (invoice + terms page).

Group the pages into one or more invoices. Rules:
- Each group must be a set of 1-indexed page numbers that belong to the SAME invoice.
- A page may appear in at most one group.
- Pages that are clearly not invoices (blank, scanner covers, unrelated documents) can be omitted from all groups.
- Continuation pages of the same invoice (terms & conditions, itemized back-side, "page 2 of 2" markers) stay with their main page.
- Different vendor names, different invoice numbers, or different totals on different pages are strong signals that the pages belong to different invoices.
- If you are not sure, prefer FEWER groups (keep adjacent pages together) rather than over-splitting.
- If the entire PDF is obviously a single invoice, return a SINGLE group listing every relevant page.

Return ONLY a JSON array, no other text, in this exact shape:
[
  { "pages": [1, 2], "hint": "Steve Madden receipt" },
  { "pages": [3], "hint": "Rogovin 32" }
]`;
}

/**
 * Vision fallback: send the full PDF to Haiku so the model can actually see
 * scanned pages. More expensive than the text path, used only when text
 * extraction yielded nothing useful (or the text pass refused to segment).
 */
async function segmentFromVision(
  client: Anthropic,
  sourceBuffer: Buffer,
  pageCount: number
): Promise<SegmentationResult> {
  const base64Pdf = sourceBuffer.toString("base64");
  const response = await client.messages.create({
    model: getSegmentationModel(),
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          { type: "text", text: buildVisionSegmentationPrompt(pageCount) },
        ],
      },
    ],
  });

  const usage = calculateHaikuCost(
    response.usage.input_tokens,
    response.usage.output_tokens
  );

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { segments: [], usage };
  }

  const raw = textBlock.text;
  console.warn(
    "[invoice-split] Haiku vision segmentation raw response:\n%s\n(tokens: %d in / %d out, $%s)",
    raw,
    usage.inputTokens,
    usage.outputTokens,
    usage.costUsd.toFixed(6)
  );

  return { segments: parseSegmentsFromLlmResponse(raw, pageCount), usage };
}

function combineUsage(a: LlmTokenUsage, b: LlmTokenUsage): LlmTokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

const MIN_TEXT_CHARS_FOR_TEXT_SEGMENTATION = 200;

/**
 * Call Claude Haiku to group the PDF's pages into per-invoice segments.
 * Uses the text path by default; falls back to vision (sending the PDF
 * bytes) when the extracted per-page text is too sparse to be useful, or
 * when the text-based pass refuses to segment (returns zero groups).
 *
 * Throws when ANTHROPIC_API_KEY is not configured — the feature is useless
 * without it and we want the UI to show a clear error.
 */
export async function segmentInvoicePages(
  sourceBuffer: Buffer,
  pages: PerPageText[],
  /**
   * Per-user (BYOK) Anthropic key. When provided, it overrides the shared
   * platform key for this single call so BYOK users pay Anthropic directly.
   */
  apiKeyOverride?: string
): Promise<SegmentationResult> {
  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key available. Splitting a multi-invoice PDF requires either a per-user BYOK key or the ANTHROPIC_API_KEY environment variable."
    );
  }

  if (pages.length === 0) {
    return { segments: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  }

  // Single-page PDFs have nothing to segment — skip the LLM call.
  if (pages.length === 1) {
    return {
      segments: [{ pages: [pages[0].pageNumber], hint: null }],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }

  const client = new Anthropic({ apiKey });

  // Decide path based on text quality. Scanned PDFs typically have ~0
  // extractable text, which makes the text-only Haiku call useless (it
  // correctly says "I cannot tell" and returns []).
  const textChars = totalTextChars(pages);
  const hasEnoughText = textChars >= MIN_TEXT_CHARS_FOR_TEXT_SEGMENTATION;

  let totalUsage: LlmTokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  if (hasEnoughText) {
    const textResult = await segmentFromText(client, pages);
    totalUsage = combineUsage(totalUsage, textResult.usage);
    if (textResult.segments.length > 0) {
      return { segments: textResult.segments, usage: totalUsage };
    }
    console.warn(
      "[invoice-split] Text-based segmentation returned zero segments; falling back to vision."
    );
  } else {
    console.warn(
      "[invoice-split] PDF has only %d chars of extractable text — skipping text segmentation and going straight to vision.",
      textChars
    );
  }

  const visionResult = await segmentFromVision(
    client,
    sourceBuffer,
    pages.length
  );
  totalUsage = combineUsage(totalUsage, visionResult.usage);
  return { segments: visionResult.segments, usage: totalUsage };
}

/**
 * Parse and validate a Haiku JSON segmentation response. Invalid /
 * out-of-range page numbers are dropped; empty groups are removed.
 *
 * Returns `[]` when the response is unparsable or contains no usable
 * segments. The caller decides what to do with that — previously we
 * fell back to a single "all pages" group, but that silently turned
 * LLM refusals on scanned PDFs into duplicate re-uploads of the source.
 */
export function parseSegmentsFromLlmResponse(
  raw: string,
  pageCount: number
): InvoiceSegment[] {
  let jsonStr = raw.trim();

  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();

  const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrMatch) jsonStr = arrMatch[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error("[invoice-split] Failed to parse segmentation JSON:", raw);
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const seenPages = new Set<number>();
  const segments: InvoiceSegment[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { pages?: unknown; hint?: unknown };
    if (!Array.isArray(entry.pages)) continue;

    const pagesArr: number[] = [];
    for (const p of entry.pages) {
      const n = typeof p === "number" ? Math.floor(p) : NaN;
      if (!Number.isFinite(n) || n < 1 || n > pageCount) continue;
      if (seenPages.has(n)) continue;
      seenPages.add(n);
      pagesArr.push(n);
    }
    if (pagesArr.length === 0) continue;
    pagesArr.sort((a, b) => a - b);

    segments.push({
      pages: pagesArr,
      hint: typeof entry.hint === "string" ? entry.hint.trim() || null : null,
    });
  }

  return segments;
}

/**
 * Build a new PDF buffer that contains only the given (1-indexed) pages from
 * the source buffer, in order. Used to materialize each segment so the
 * existing extraction pipeline / duplicate detector operates on a fresh file.
 */
export async function buildSubPdf(
  sourceBuffer: Buffer,
  pageNumbers: number[]
): Promise<Buffer> {
  if (pageNumbers.length === 0) {
    throw new Error("Cannot build a sub-PDF from zero pages");
  }
  const source = await PDFDocument.load(sourceBuffer);
  const totalPages = source.getPageCount();
  const zeroIndexed = pageNumbers.map((p) => p - 1);
  for (const idx of zeroIndexed) {
    if (idx < 0 || idx >= totalPages) {
      throw new Error(
        `Page ${idx + 1} is out of range (source PDF has ${totalPages} pages)`
      );
    }
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, zeroIndexed);
  for (const page of copied) out.addPage(page);
  const bytes = await out.save();
  return Buffer.from(bytes);
}
