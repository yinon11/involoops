/**
 * Deterministic correction when LLM/OCR returns inconsistent ILS gross vs VAT,
 * gated by operator extraction notes that mention 18% VAT reconciliation.
 */

import type { ExtractedInvoiceData } from "@/types/invoice";

/** VAT component of a VAT-inclusive gross at 18% on net: V = G × 18/118 */
const VAT_FRACTION_OF_GROSS = 18 / 118;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * True when merged extraction instructions ask for ~18% VAT checks (English or Hebrew).
 */
export function extractionInstructionsSuggestIls18Reconcile(
  instructions: string | undefined,
): boolean {
  if (!instructions?.trim()) return false;
  const s = instructions;
  if (/\b18\s*%/.test(s)) return true;
  /** Handwritten labels like מע״מ %18 */
  if (/%\s*18\b/.test(s)) return true;
  if (/\b18\s+percent\b/i.test(s)) return true;
  if (/vat[^\n]{0,40}18|18[^\n]{0,40}vat/i.test(s)) return true;
  // Hebrew מע״מ / מע"מ near 18
  if (/מע["״']מ[^\n]{0,50}18|18[^\n]{0,50}מע["״']מ/.test(s)) return true;
  /** Prompt/platform phrases that imply inclusive 18% reconciliation */
  if (/118\s*[÷/]\s*18/.test(s)) return true;
  return false;
}

/**
 * If hints mention 18% VAT and gross/VAT disagree badly with Israeli inclusive pricing,
 * adjust the least-invasive single field so V ≈ G × 18/118.
 *
 * Skips correction when VAT share of gross looks handwritten-plausible **and**
 * VAT ≈ gross × (18÷118) within a tight shekel band. Otherwise picks the smaller
 * single-field fix (adjust מע״מ vs adjust סה״כ כולל מע״מ) toward inclusive 18% math.
 */
export function maybeReconcileIlsVatInclusiveFromHints(
  data: ExtractedInvoiceData,
  mergedInstructions: string | undefined,
): ExtractedInvoiceData {
  if (!extractionInstructionsSuggestIls18Reconcile(mergedInstructions)) {
    return data;
  }
  if (data.currency !== "ILS") return data;

  const G = data.amount;
  const V = data.vatAmount;
  if (G == null || V == null || G <= 0 || V <= 0) return data;

  const ratio = V / G;
  /** Inclusive invoice: VAT is usually well below gross and ~9–20% of gross when handwritten. */
  const plausibleHandwrittenVatShare =
    ratio >= 0.085 &&
    ratio <= 0.205 &&
    V < G * 0.98;

  const V_from_G = round2(G * VAT_FRACTION_OF_GROSS);
  /** Tight check: at exact 18% on net, VAT should match gross × 18/118 within normal shekel rounding. */
  const inclusiveGap = Math.abs(V - V_from_G);
  const inclusiveTol = Math.min(28, Math.max(10, G * 0.0035));

  if (
    plausibleHandwrittenVatShare &&
    inclusiveGap <= inclusiveTol
  ) {
    return data;
  }

  const G_from_V = round2(V * (118 / 18));

  const pairErr = Math.abs(V - V_from_G);

  const deltaFixV = pairErr;
  const deltaFixG = Math.abs(G - G_from_V);

  if (deltaFixV <= deltaFixG) {
    const newV = V_from_G;
    const net = round2(G - newV);
    console.warn(
      "[invoice-extract] ILS 18% reconciliation (hints): vatAmount %s -> %s for gross %s (pair error was %s)",
      String(V),
      String(newV),
      String(G),
      pairErr.toFixed(2),
    );
    return {
      ...data,
      vatAmount: newV,
      amountWithoutVat: net,
    };
  }

  const newG = G_from_V;
  const net = round2(newG - V);
  console.warn(
    "[invoice-extract] ILS 18% reconciliation (hints): amount %s -> %s from vatAmount %s (pair error was %s)",
    String(G),
    String(newG),
    String(V),
    pairErr.toFixed(2),
  );
  return {
    ...data,
    amount: newG,
    amountWithoutVat: net,
  };
}
