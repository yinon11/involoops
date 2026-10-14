/**
 * Main invoice extraction pipeline orchestrator.
 *
 * Coordinates text extraction, vendor matching, field parsing,
 * and vision-based fallback to produce a complete ExtractionResult.
 */

import type { ExtractedInvoiceData, ExtractionResult, LlmTokenUsage } from '@/types/invoice';
import type { VendorRule } from '@/types/vendor';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ZERO_USAGE, sumLlmUsage } from './llm-cost';
import { extractTextFromPdf } from './text-extractor';
import {
  extractVendorFooterAddressFallbackLine,
  extractVendorNameFallbackLine,
  isFooterStreetAddressVendorLabel,
  parseInvoiceFields,
} from './field-parser';
import { matchVendor } from './vendor-matcher';
import { extractWithVision } from './vision-extractor';
import { extractWithTextLlm } from './text-llm-extractor';
import { applyVendorRule } from './vendor-rules';
import { ensureAmountUsd } from '@/lib/fx';
import { maybeReconcileIlsVatInclusiveFromHints } from './ils-vat-reconcile';
import { AnthropicModelAccessError } from './anthropic-models';
import { buildSubPdf } from './segment-pdf';

/**
 * Scanned / image-heavy PDFs use vision (OCR-style). Cap pages to control cost.
 */
const VISION_OCR_MAX_PAGES = 2;

export interface VendorInfo {
  id: string;
  name: string;
  aliases: string[];
  /**
   * Deprioritize during matching. Typically the user's own business (income
   * source). Only matched when no regular vendor matches — avoids false
   * positives when the user's name appears in recipient / contact blocks of
   * other vendors' invoices.
   */
  isIncomeSource?: boolean;
}

/**
 * General (vendorId `null`) instructions first, then vendor-specific for `matchedVendorId`.
 * Each group sorted by `priority`. Used by both text and vision LLM paths.
 */
function mergedInstructionsForLlm(
  vendorRules: VendorRule[],
  matchedVendorId: string | null | undefined
): string | undefined {
  const globalParts = vendorRules
    .filter((r) => r.vendorId == null)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((r) => r.instructions?.trim())
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  const vendorParts =
    matchedVendorId != null && matchedVendorId !== ""
      ? vendorRules
          .filter((r) => r.vendorId === matchedVendorId)
          .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
          .map((r) => r.instructions?.trim())
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];

  const parts = [...globalParts, ...vendorParts];
  if (parts.length === 0) return undefined;
  return parts.join("\n\n---\n\n");
}

/**
 * Production uploads often have **no** DB extraction rules while local scripts
 * inject hints — prepend stable platform guidance so vision + ILS reconcile match.
 */
const PLATFORM_VISION_EXTRACTION_HINTS =
  "Israeli handwritten חשבוניות often show מע״מ **%18** (standard **18%** VAT on net). If סה״כ כולל מע״מ is **smaller** than סכום לפני מע״מ / סה״כ לפני מע״מ, digit grouping is wrong. Cross-check: gross≈מע״מ×(118÷18) when מע״מ line is clear; net=gross−VAT with VAT÷net≈**18%**.";

function mergeVisionInstructionsWithPlatformDefaults(
  mergedFromRules: string | undefined,
): string {
  const p = PLATFORM_VISION_EXTRACTION_HINTS.trim();
  const u = mergedFromRules?.trim();
  if (!u) return p;
  return `${p}\n\n---\n\n${u}`;
}

function visionInstructionsForLlm(
  vendorRules: VendorRule[],
  matchedVendorId: string | null | undefined,
): string {
  return mergeVisionInstructionsWithPlatformDefaults(
    mergedInstructionsForLlm(vendorRules, matchedVendorId),
  );
}

/**
 * After the text + regex + text-LLM path, decide whether we still need one
 * vision OCR pass on the **rendered** PDF (outlined type, bad columns, etc.).
 *
 * Triggers when any of these are still missing: **invoice number**, **vendor
 * name** (or only a footer street line we used as a placeholder), or **total
 * amount**. VAT is intentionally **not** a trigger — many invoices have no VAT.
 */
function textPathNeedsVisionOcrSupplement(data: ExtractedInvoiceData): boolean {
  if (!data.invoiceNumber?.trim()) return true;
  if (!data.vendorName?.trim()) return true;
  if (isFooterStreetAddressVendorLabel(data.vendorName)) return true;
  if (data.amount == null) return true;
  return false;
}

/**
 * Merge only vision fields that still **fill gaps** in the text path — we
 * never overwrite a confident text/LLM vendor name or amount with vision
 * `null`, and we never assign a vendor name that matches `<own_business>`.
 */
function buildTextPathVisionSupplementPatch(
  merged: ExtractedInvoiceData,
  vision: ExtractedInvoiceData,
  ownBusinessNames: string[],
): Partial<ExtractedInvoiceData> {
  const patch: Partial<ExtractedInvoiceData> = {};

  const weakVendor =
    !merged.vendorName?.trim() ||
    isFooterStreetAddressVendorLabel(merged.vendorName);

  const vn = vision.vendorName?.trim() ?? '';
  if (vn.length >= 2 && weakVendor) {
    const lower = vn.toLowerCase();
    const hitsOwn = ownBusinessNames
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length >= 2)
      .some((n) => lower.includes(n));
    if (!hitsOwn) {
      patch.vendorName = vision.vendorName;
    }
  }

  if (!merged.invoiceNumber?.trim() && vision.invoiceNumber?.trim()) {
    patch.invoiceNumber = vision.invoiceNumber;
  }

  if (merged.amount == null && vision.amount != null) {
    patch.amount = vision.amount;
  }

  if (!merged.currency?.trim() && vision.currency?.trim()) {
    patch.currency = vision.currency;
  }

  return patch;
}

/**
 * Build the set of names the account owner has told us belong to *them*:
 * the brand they set in Settings (`users.companyName`) plus every vendor
 * flagged `isIncomeSource = true` (and its aliases). These are passed to
 * the LLM as a hard negative filter on `vendorName` so the model never
 * mis-picks the user's own business as the supplier — a common failure
 * mode in multi-column Hebrew layouts (e.g. חשבשבת) where the customer
 * block appears at the top and the supplier letterhead appears below the
 * "לכבוד" label.
 *
 * Names are trimmed and de-duped case-insensitively. The function
 * tolerates missing inputs and never throws.
 */
async function collectOwnBusinessNames(
  userId: string,
  vendors: VendorInfo[],
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  for (const v of vendors) {
    if (!v.isIncomeSource) continue;
    push(v.name);
    for (const alias of v.aliases ?? []) push(alias);
  }

  try {
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { companyName: true, name: true },
    });
    push(row?.companyName);
    // Sole proprietors often have no companyName and the person's name is
    // what appears as the billed customer. Include it only when no
    // companyName is set so we don't over-broaden the filter for normal users.
    if (!row?.companyName) push(row?.name);
  } catch {
    // DB lookup is best-effort — if it fails we still pass income-source
    // vendor names. Never block extraction over this.
  }

  return out;
}

/**
 * Process a PDF invoice through the full extraction pipeline.
 *
 * Pipeline flow:
 * 1. Extract text from PDF
 * 2. If text-based: parse fields (regex) -> vendor match on extracted vendor name -> one Claude text call with merged global + vendor notes -> merge -> vendor match on LLM vendor name -> optional legacy regex overrides -> merge
 * 3. If not text-based: vision step (reasoning + JSON, max 2 pages) -> vendor match -> optional vision rerun -> regex overrides -> merge
 * 4. Calculate confidence
 */
export async function processInvoice(
  pdfBuffer: Buffer,
  userId: string,
  vendors: VendorInfo[],
  vendorRules: VendorRule[],
  /**
   * Per-user (BYOK) Anthropic key. When present, every LLM call in the
   * pipeline authenticates with the user's own key instead of the shared
   * platform key. Server-only; never round-tripped to the client.
   */
  anthropicApiKey?: string | null
): Promise<ExtractionResult> {
  // Step 1: Extract text from PDF
  const textResult = await extractTextFromPdf(pdfBuffer);

  // Reject absurdly large PDFs — they're either mistakes or a cost-abuse
  // vector (a 5000-page PDF can burn a lot of LLM tokens). Text-based PDFs
  // still get processed because text extraction is cheap; vision is the
  // expensive path and is guarded below.
  if (!textResult.isTextBased && textResult.pageCount > VISION_OCR_MAX_PAGES) {
    throw new Error(
      `PDF has ${textResult.pageCount} pages; scanned/image (OCR) extraction accepts at most ${VISION_OCR_MAX_PAGES} pages per file. Split the PDF or upload fewer pages.`,
    );
  }

  // Resolve the user's "own business" names once and pass to both branches.
  // This is the authoritative negative hint for vendorName — see
  // collectOwnBusinessNames for the source list and rationale.
  const ownBusinessNames = await collectOwnBusinessNames(userId, vendors);
  if (ownBusinessNames.length > 0) {
    console.warn(
      '[invoice-extract] Own-business names passed to LLM (negative filter for vendorName): %s',
      JSON.stringify(ownBusinessNames),
    );
  }

  if (textResult.isTextBased) {
    return processTextBased(
      pdfBuffer,
      textResult.text,
      textResult.layoutText,
      textResult.pageCount,
      vendors,
      vendorRules,
      anthropicApiKey ?? undefined,
      ownBusinessNames,
    );
  }

  return processVisionBased(
    pdfBuffer,
    textResult.text,
    textResult.layoutText,
    textResult.pageCount,
    vendors,
    vendorRules,
    anthropicApiKey ?? undefined,
    ownBusinessNames,
  );
}

/**
 * Process a text-based PDF through vendor matching and field parsing.
 *
 * `rawText` keeps its existing role — fed to the regex baseline and to
 * the fallback heuristics that already assume a flat glyph stream.
 * `layoutText` is a layout-aware reconstruction of the same content
 * (rows + column spacing preserved) and is what we hand to the LLM.
 * Hebrew multi-column invoices were previously flattened into a single
 * line, hiding which side of the page each business name came from.
 *
 * When the PDF is **text-based** but core fields are still missing after the
 * text pipeline — **invoice number**, **vendor name** (or only a footer street
 * placeholder), or **total amount** — we run **one vision pass** on the
 * rendered PDF (≤ `VISION_OCR_MAX_PAGES`). Missing VAT alone does **not**
 * trigger vision.
 */
async function processTextBased(
  pdfBuffer: Buffer,
  rawText: string,
  layoutText: string,
  pageCount: number,
  vendors: VendorInfo[],
  vendorRules: VendorRule[],
  anthropicApiKey?: string,
  ownBusinessNames: string[] = [],
): Promise<ExtractionResult> {
  // Regex/heuristics first, then one LLM pass with the same JSON schema as vision (fills/overrides fields).
  const baselineRegex = parseInvoiceFields(rawText);
  let generalData = baselineRegex;

  // Early vendor match: use the regex-extracted vendor name (if any) to load
  // vendor-specific LLM instructions. Falls back to null when no name yet.
  // Note: the regex pick is unreliable (it may grab a letterhead line that
  // happens to contain another vendor's name), so we re-check after the LLM
  // returns a more reliable vendorName and may re-run the LLM with corrected
  // instructions below.
  const earlyVendorName = generalData.vendorName?.trim() || null;
  const earlyVendorMatch = earlyVendorName
    ? matchVendor(earlyVendorName, vendors)
    : null;
  const earlyInstructions = mergedInstructionsForLlm(
    vendorRules,
    earlyVendorMatch?.vendorId ?? null
  );

  const usages: LlmTokenUsage[] = [];
  const llmResult = await extractWithTextLlm(
    rawText,
    earlyInstructions,
    anthropicApiKey,
    ownBusinessNames,
    layoutText,
  );
  if (llmResult) {
    generalData = mergeExtractionData(generalData, llmResult.data);
    usages.push(llmResult.usage);
  }

  // Step 2a: Match vendor using only the LLM-extracted vendor name — NOT the
  // full PDF text. The raw text contains names of other parties (recipients,
  // contacts, banks) that cause false-positive matches.
  const vendorMatchText = generalData.vendorName?.trim() || '';
  // Server-only: appears in the Next.js / Docker terminal — not the browser console.
  console.warn(
    '[invoice-extract] Text path: looking for vendor match against vendorName only: %s',
    vendorMatchText.length > 0 ? JSON.stringify(vendorMatchText) : 'null'
  );
  const vendorMatch = vendorMatchText.length > 0
    ? matchVendor(vendorMatchText, vendors)
    : null;
  console.warn(
    '[invoice-extract] Text path: matchedVendorId=%s',
    vendorMatch?.vendorId ?? 'null'
  );

  // If the correct vendor was only identified *after* the LLM call (the early
  // regex-based guess matched a different vendor, or matched none), and the
  // correct vendor's notes differ from what we passed initially, re-run the LLM
  // once so the user's extraction notes actually influence the output.
  // Without this, a note like "WeWork invoices should always be 0" is silently
  // dropped whenever the early match picked the wrong vendor.
  if (
    vendorMatch &&
    vendorMatch.vendorId !== (earlyVendorMatch?.vendorId ?? null)
  ) {
    const finalInstructions = mergedInstructionsForLlm(
      vendorRules,
      vendorMatch.vendorId
    );
    if (finalInstructions !== earlyInstructions) {
      console.warn(
        '[invoice-extract] Text path: early vendor guess differed from final match (early=%s, final=%s) and vendor notes differ — re-running text LLM with final vendor notes.',
        earlyVendorMatch?.vendorId ?? 'null',
        vendorMatch.vendorId
      );
      const rerun = await extractWithTextLlm(
        rawText,
        finalInstructions,
        anthropicApiKey,
        ownBusinessNames,
        layoutText,
      );
      if (rerun) {
        usages.push(rerun.usage);
        // Rebuild from the regex baseline + rerun so the correct vendor's
        // notes (e.g. "always 0") override the first LLM's values instead of
        // being shadowed by them.
        generalData = mergeExtractionData(baselineRegex, rerun.data);
      }
    }
  }

  // Step 2b: Apply vendor-specific rules if available
  let vendorData: Partial<ExtractedInvoiceData> = {};
  if (vendorMatch) {
    const rule = vendorRules.find((r) => r.vendorId === vendorMatch.vendorId);
    if (rule) {
      vendorData = applyVendorRule(rawText, rule);
    }
  }

  // Step 2c: (generalData already computed)

  // Step 2d: Merge results (vendor-specific overrides general)
  let mergedData = mergeExtractionData(generalData, vendorData);

  // One vision pass on the rendered PDF when core fields are still missing
  // after text + regex + text-LLM (invoice #, vendor name, or total).
  // Outlined letterhead, broken columns, or weak totals are common reasons.
  const hasAnthropicKey =
    (typeof anthropicApiKey === 'string' && anthropicApiKey.length > 0) ||
    (typeof process.env.ANTHROPIC_API_KEY === 'string' &&
      process.env.ANTHROPIC_API_KEY.length > 0);

  if (hasAnthropicKey && textPathNeedsVisionOcrSupplement(mergedData)) {
    const reasons: string[] = [];
    if (!mergedData.invoiceNumber?.trim()) reasons.push('invoiceNumber');
    if (!mergedData.vendorName?.trim()) reasons.push('vendorName');
    else if (isFooterStreetAddressVendorLabel(mergedData.vendorName)) {
      reasons.push('vendorName(footer-address-only)');
    }
    if (mergedData.amount == null) reasons.push('amount');

    console.warn(
      '[invoice-extract] Text path: vision OCR supplement — missing %s (VAT not required).',
      reasons.join(', '),
    );
    try {
      const visionInstructions = visionInstructionsForLlm(vendorRules, null);
      const visionPageNumbers = Array.from(
        { length: Math.min(pageCount, VISION_OCR_MAX_PAGES) },
        (_, i) => i + 1,
      );
      const visionPdfBuffer =
        pageCount > VISION_OCR_MAX_PAGES
          ? await buildSubPdf(pdfBuffer, visionPageNumbers)
          : pdfBuffer;
      if (pageCount > VISION_OCR_MAX_PAGES) {
        console.warn(
          '[invoice-extract] Text path: vision supplement uses first %d of %d page(s).',
          visionPageNumbers.length,
          pageCount,
        );
      }
      const vision = await extractWithVision(
        visionPdfBuffer,
        visionInstructions,
        anthropicApiKey,
        ownBusinessNames,
      );
      usages.push(vision.usage);

      const patch = buildTextPathVisionSupplementPatch(
        mergedData,
        vision.data,
        ownBusinessNames,
      );
      if (Object.keys(patch).length > 0) {
        mergedData = mergeExtractionData(mergedData, patch);
      }
    } catch (err) {
      if (err instanceof AnthropicModelAccessError) {
        throw err;
      }
      console.warn(
        '[invoice-extract] Text path: vision supplement failed (keeping text-path result): %s',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Heuristic vendor label only after vision — a false fallback (e.g. the
  // "לכבוד" customer `בע"מ`) used to block the vision supplement entirely.
  if (!vendorMatch && !mergedData.vendorName?.trim()) {
    let fb = extractVendorNameFallbackLine(layoutText, ownBusinessNames);
    if (!fb && mergedData.description?.trim()) {
      const first = mergedData.description.split('\n')[0]?.trim() ?? '';
      const sentence = first.split(/\.(?:\s|$)/)[0]?.trim() ?? first;
      const looksLikeBusinessName = /(?:בע["״']מ|\bLtd\.?\b|\bInc\.?\b|\bLLC\b|\bCorp\.?\b|\bGmbH\b|\bPBC\b|\bPLC\b|\bSARL\b)/i.test(sentence);
      const lower = sentence.toLowerCase();
      const containsOwnName = ownBusinessNames
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n.length >= 2)
        .some((n) => lower.includes(n));
      if (
        looksLikeBusinessName &&
        !containsOwnName &&
        sentence.length >= 3 &&
        sentence.length <= 120
      ) {
        fb = sentence.slice(0, 80);
      }
    }
    if (!fb) {
      fb = extractVendorFooterAddressFallbackLine(
        layoutText.trim().length > 0 ? layoutText : rawText,
        ownBusinessNames,
      );
    }
    if (fb) {
      mergedData = { ...mergedData, vendorName: fb };
    }
  }

  let finalVendorMatch = vendorMatch;
  {
    const vn = mergedData.vendorName?.trim();
    if (vn) {
      const m = matchVendor(vn, vendors);
      if (m) {
        finalVendorMatch = m;
        const rule = vendorRules.find((r) => r.vendorId === m.vendorId);
        if (rule) {
          mergedData = mergeExtractionData(mergedData, applyVendorRule(rawText, rule));
        }
      }
    }
  }

  const llmUsage: LlmTokenUsage =
    usages.length === 0 ? ZERO_USAGE : sumLlmUsage(usages);

  console.warn(
    '[invoice-extract] Text path: vendor label on invoice (pending / suggestedVendorName): %s',
    mergedData.vendorName != null
      ? JSON.stringify(mergedData.vendorName)
      : '(none)'
  );
  if (!finalVendorMatch) {
    console.warn(
      '[invoice-extract] Text path: no linked vendor — pending shows this extracted label until you link a vendor.'
    );
  }

  mergedData = maybeReconcileIlsVatInclusiveFromHints(
    mergedData,
    mergedInstructionsForLlm(vendorRules, finalVendorMatch?.vendorId ?? null),
  );

  mergedData = ensureAmountUsd(mergedData);

  // Step 2e: Calculate confidence
  const confidence = calculateConfidence(mergedData);

  return {
    data: mergedData,
    confidence,
    method: 'text',
    rawText,
    pageCount,
    matchedVendorId: finalVendorMatch?.vendorId ?? null,
    extractionFailed: false,
    llmUsage,
  };
}

/**
 * Process using vision-based extraction as fallback.
 *
 * `layoutText` is the row-/column-preserved view from `text-extractor.ts`.
 * Most scanned PDFs have no useful text layer here (the vision LLM works
 * off the rendered image), but when *some* glyphs are present we prefer
 * the layout view for the vendor-label fallback so it sees real rows.
 */
async function processVisionBased(
  pdfBuffer: Buffer,
  rawText: string,
  layoutText: string,
  pageCount: number,
  vendors: VendorInfo[],
  vendorRules: VendorRule[],
  anthropicApiKey?: string,
  ownBusinessNames: string[] = [],
): Promise<ExtractionResult> {
  try {
    const baselineRegex = parseInvoiceFields(rawText);

    const earlyVendorName = baselineRegex.vendorName?.trim() || null;
    const earlyVendorMatch = earlyVendorName
      ? matchVendor(earlyVendorName, vendors)
      : null;
    const earlyInstructions = visionInstructionsForLlm(
      vendorRules,
      earlyVendorMatch?.vendorId ?? null,
    );

    const usages: LlmTokenUsage[] = [];
    const visionResult = await extractWithVision(
      pdfBuffer,
      earlyInstructions,
      anthropicApiKey,
      ownBusinessNames,
    );
    usages.push(visionResult.usage);

    let generalData = mergeExtractionData(baselineRegex, visionResult.data);

    const vendorMatchText = generalData.vendorName?.trim() || '';
    console.warn(
      '[invoice-extract] Vision path: looking for vendor match against vendorName only: %s',
      vendorMatchText.length > 0 ? JSON.stringify(vendorMatchText) : 'null'
    );
    const vendorMatch = vendorMatchText.length > 0
      ? matchVendor(vendorMatchText, vendors)
      : null;
    console.warn(
      '[invoice-extract] Vision path: matchedVendorId=%s',
      vendorMatch?.vendorId ?? 'null'
    );

    if (
      vendorMatch &&
      vendorMatch.vendorId !== (earlyVendorMatch?.vendorId ?? null)
    ) {
      const finalInstructions = visionInstructionsForLlm(
        vendorRules,
        vendorMatch.vendorId,
      );
      if (finalInstructions !== earlyInstructions) {
        console.warn(
          '[invoice-extract] Vision path: early vendor guess differed from final match (early=%s, final=%s) and vendor notes differ — re-running vision LLM with final vendor notes.',
          earlyVendorMatch?.vendorId ?? 'null',
          vendorMatch.vendorId
        );
        const rerun = await extractWithVision(
          pdfBuffer,
          finalInstructions,
          anthropicApiKey,
          ownBusinessNames,
        );
        usages.push(rerun.usage);
        generalData = mergeExtractionData(baselineRegex, rerun.data);
      }
    }

    const llmUsage: LlmTokenUsage =
      usages.length === 0 ? ZERO_USAGE : sumLlmUsage(usages);

    let vendorData: Partial<ExtractedInvoiceData> = {};
    if (vendorMatch) {
      const rule = vendorRules.find((r) => r.vendorId === vendorMatch.vendorId);
      if (rule) {
        vendorData = applyVendorRule(rawText, rule);
      }
    }

    let mergedData = mergeExtractionData(generalData, vendorData);

    // Same hardening as the text path: pass own-business names so we never
    // pick the customer block, and use a business-suffix check for the
    // description fallback rather than blindly truncating it.
    if (!vendorMatch && !mergedData.vendorName?.trim()) {
      // Prefer layoutText (real rows) but fall back to rawText for scanned
      // PDFs whose text layer is empty. Pass the raw text in — the fallback
      // wants the original wide whitespace to detect column boundaries.
      const fallbackSource = layoutText.trim().length > 0 ? layoutText : rawText;
      let fb = extractVendorNameFallbackLine(
        fallbackSource,
        ownBusinessNames,
      );
      if (!fb && mergedData.description?.trim()) {
        const first = mergedData.description.split('\n')[0]?.trim() ?? '';
        const sentence = first.split(/\.(?:\s|$)/)[0]?.trim() ?? first;
        const looksLikeBusinessName = /(?:בע["״']מ|\bLtd\.?\b|\bInc\.?\b|\bLLC\b|\bCorp\.?\b|\bGmbH\b|\bPBC\b|\bPLC\b|\bSARL\b)/i.test(sentence);
        const lower = sentence.toLowerCase();
        const containsOwnName = ownBusinessNames
          .map((n) => n.trim().toLowerCase())
          .filter((n) => n.length >= 2)
          .some((n) => lower.includes(n));
        if (
          looksLikeBusinessName &&
          !containsOwnName &&
          sentence.length >= 3 &&
          sentence.length <= 120
        ) {
          fb = sentence.slice(0, 80);
        }
      }
      if (!fb) {
        fb = extractVendorFooterAddressFallbackLine(
          fallbackSource,
          ownBusinessNames,
        );
      }
      if (fb) {
        mergedData = { ...mergedData, vendorName: fb };
      }
    }

    console.warn(
      '[invoice-extract] Vision path: vendor label on invoice (pending / suggestedVendorName): %s',
      mergedData.vendorName != null
        ? JSON.stringify(mergedData.vendorName)
        : '(none)'
    );
    if (!vendorMatch) {
      console.warn(
        '[invoice-extract] Vision path: no linked vendor — pending shows this extracted label until you link a vendor.'
      );
    }

    mergedData = maybeReconcileIlsVatInclusiveFromHints(
      mergedData,
      visionInstructionsForLlm(vendorRules, vendorMatch?.vendorId ?? null),
    );

    mergedData = ensureAmountUsd(mergedData);

    const fieldCount = countExtractedFields(mergedData);
    const confidence = Math.min(0.5 + fieldCount * 0.03, 0.7);

    return {
      data: mergedData,
      confidence,
      method: 'vision',
      rawText,
      pageCount,
      matchedVendorId: vendorMatch?.vendorId ?? null,
      extractionFailed: false,
      llmUsage,
    };
  } catch (error) {
    console.error('Vision extraction failed:', error);

    const emptyData: ExtractedInvoiceData = {
      invoiceDate: null,
      vendorName: null,
      amount: null,
      currency: null,
      amountUsd: null,
      vatAmount: null,
      amountWithoutVat: null,
      invoiceNumber: null,
      description: null,
      expenseCategory: null,
      isFixedAsset: false,
    };

    return {
      data: emptyData,
      confidence: 0,
      method: 'text',
      rawText,
      pageCount,
      matchedVendorId: null,
      extractionFailed: true,
      llmUsage: ZERO_USAGE,
    };
  }
}

/**
 * Prefer `override` when it was passed (including explicit `null`).
 * `??` would incorrectly drop explicit `null` from the LLM and keep noisy regex values.
 */
function mergeField<T>(general: T, override: T | undefined): T {
  return override !== undefined ? override : general;
}

/**
 * Merge extraction layers: later layers override earlier when a field is present.
 * Explicit `null` from the LLM wins over heuristic guesses (e.g. bogus VAT near "tax").
 */
function mergeExtractionData(
  general: ExtractedInvoiceData,
  vendorOverrides: Partial<ExtractedInvoiceData>
): ExtractedInvoiceData {
  return {
    invoiceDate: mergeField(general.invoiceDate, vendorOverrides.invoiceDate),
    vendorName: mergeField(general.vendorName, vendorOverrides.vendorName),
    amount: mergeField(general.amount, vendorOverrides.amount),
    currency: mergeField(general.currency, vendorOverrides.currency),
    amountUsd: mergeField(general.amountUsd, vendorOverrides.amountUsd),
    vatAmount: mergeField(general.vatAmount, vendorOverrides.vatAmount),
    amountWithoutVat: mergeField(
      general.amountWithoutVat,
      vendorOverrides.amountWithoutVat
    ),
    invoiceNumber: mergeField(general.invoiceNumber, vendorOverrides.invoiceNumber),
    description: mergeField(general.description, vendorOverrides.description),
    expenseCategory: mergeField(
      general.expenseCategory,
      vendorOverrides.expenseCategory,
    ),
    isFixedAsset:
      vendorOverrides.isFixedAsset !== undefined
        ? vendorOverrides.isFixedAsset
        : general.isFixedAsset,
  };
}

/**
 * Calculate extraction confidence based on how many fields were extracted.
 */
function calculateConfidence(data: ExtractedInvoiceData): number {
  const fields: (keyof ExtractedInvoiceData)[] = [
    'invoiceDate',
    'vendorName',
    'amount',
    'currency',
    'amountUsd',
    'vatAmount',
    'invoiceNumber',
    'description',
  ];

  // Weight critical fields more heavily
  const weights: Record<string, number> = {
    amount: 0.25,
    invoiceDate: 0.2,
    vendorName: 0.15,
    currency: 0.1,
    amountUsd: 0.05,
    vatAmount: 0.1,
    invoiceNumber: 0.1,
    description: 0.05,
  };

  let score = 0;
  for (const field of fields) {
    if (data[field] !== null && data[field] !== undefined) {
      score += weights[field] || 0.1;
    }
  }

  return Math.min(Math.round(score * 100) / 100, 1.0);
}

/**
 * Count how many fields have non-null values.
 */
function countExtractedFields(data: ExtractedInvoiceData): number {
  const fields: (keyof ExtractedInvoiceData)[] = [
    'invoiceDate',
    'vendorName',
    'amount',
    'currency',
    'amountUsd',
    'vatAmount',
    'invoiceNumber',
    'description',
  ];

  return fields.filter((f) => data[f] !== null && data[f] !== undefined).length;
}

