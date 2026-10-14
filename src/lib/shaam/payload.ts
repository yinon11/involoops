import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/audit/canonical-json";
import { formatMoney, negateMoney } from "@/lib/money";
import type { DocumentType } from "@/lib/documents/types";
import type { OutboundLineItem } from "@/db/schema/outbound-invoices";

/**
 * SHAAM "Israel Invoice" JSON v2.0 payload builder (Spec 08).
 *
 * Wire format follows the v2.0 spec (Israel Invoice Model 7/2024 — the Tax
 * Authority's "Instructions for software houses" / הוראות לבתי תוכנה, published
 * on gov.il; not redistributed with this repository), Tables 2.1 + 2.2:
 *
 *   - Field names are mostly **snake_case** with a handful of fields
 *     that the spec writes as PascalCase (`Action` at item 23,
 *     `Discount` at item 18, plus item-level `Index`/`Category`/
 *     `Description`/`Quantity`/`Discount`). v2 also requires "all
 *     input fields to be recorded in lowercase only" (KNOWN_ISSUES.md
 *     §SHAAM clearance) — interpreted here as **field NAMES are
 *     lowercase** (no PascalCase variants) and **string VALUES are
 *     lowercased** before serialisation. This is the most defensible
 *     reading of an ambiguous note; if ITA's swagger turns out to want
 *     the spec's mixed case literally, switch the few PascalCase keys
 *     here and re-run.
 *   - Money / counts / codes are **numbers**, not strings. The v1
 *     payload sent everything as `"123.45"` strings, which is the
 *     bug surfaced by `JSV0001 Invalid value type 'string'` from
 *     ITA's schema validator at line 348 of the swagger.
 *   - Dates are `YYYY-MM-DD` strings.
 *
 * Determinism: `buildShaamPayload` returns a stable object for the
 * same inputs so `computeIdempotencyKey` / `computePayloadHash` over
 * `canonicalJson` give byte-identical output across runs.
 */

/**
 * Action codes per Table 2.1 item 23. The spec only documents two
 * non-default values:
 *   - 3 = inversion of the charge (reverse charge); requires
 *     `vat_amount = 0` and is a CM field (only sent when applicable)
 *   - 4 = tax invoice originating from a proforma / pre-approval
 *     document (Section 2.4)
 *
 * For ordinary new invoices the spec omits an `action` value entirely
 * (the code is implicit). Code `1` and `2` are kept as literal types
 * for backwards compatibility with `submitDocumentToShaam` callers
 * but are **not** emitted on the wire — only `3` and `4` are.
 */
export type ShaamActionCode = 1 | 2 | 3 | 4;

/**
 * Per-line item (Table 2.2). All numeric fields are JSON numbers.
 * Field names follow the spec exactly but lowercased per the v2 rule.
 */
export interface ShaamLine {
  catalog_id?: string;
  category?: number;
  description?: string;
  measure_unit_description?: string;
  quantity: number;
  price_per_unit: number;
  discount?: number;
  total_amount: number;
  vat_rate: number;
  vat_amount?: number;
}

/**
 * Top-level approval payload (Table 2.1).
 *
 * Mandatory fields per the spec are non-optional in this type;
 * conditional-mandatory ones (CM in the spec) are typed as optional
 * and only set when their precondition is met.
 */
export interface ShaamInvoicePayload {
  invoice_id: string;
  invoice_type: number;
  vat_number: number;
  union_vat_number?: number;
  authorized_company?: number;
  user_id?: number;
  user_name?: string;
  invoice_reference_number: string;
  customer_vat_number?: number;
  customer_name?: string;
  customer_country_code?: string;
  invoice_date: string;
  invoice_issuance_date: string;
  branch_id?: string;
  accounting_software_number: number;
  client_software_key?: string;
  amount_before_discount: number;
  discount: number;
  payment_amount: number;
  vat_amount: number;
  payment_amount_including_vat: number;
  invoice_note?: string;
  /** Only emitted for action codes 3 (reverse charge) and 4 (proforma → invoice). */
  action?: number;
  items?: ShaamLine[];
  /**
   * Credit-note linkage. Not in Table 2.1 (the spec ties credits to
   * originals via the bookkeeping system rather than the API), but
   * we keep the back-reference fields so the receiving end can
   * correlate without a database lookup. Lower-cased to match the
   * rest of the v2 payload.
   */
  reference_invoice_id?: string;
  reference_allocation_number?: string;
}

/**
 * Numeric invoice-type codes per Table 2.5 of the v2.0 spec.
 *
 * Note: the SHAAM API uses different numeric codes for "PROFORMA"
 * (332) than the Uniform Structure (300) — `c100.ts:documentTypeToCode`
 * intentionally diverges. See KNOWN_ISSUES.md §SHAAM clearance.
 */
const INVOICE_TYPE_CODE: Record<DocumentType, number> = {
  TAX_INVOICE: 305,
  TAX_INVOICE_RECEIPT: 320,
  RECEIPT: 400,
  CREDIT_INVOICE: 330,
  PROFORMA: 332,
  DELIVERY_NOTE: 200,
};

/**
 * Default 6-character subcategory codes for line items (v2 Table 2.4).
 *
 * Format:
 *   - first char: 1 = goods, 2 = services, 3 = credit goods,
 *     4 = credit services
 *   - last 5 chars: classification 00001..00021 or 99999 = "Others"
 *
 * Without per-line classification on `outbound_invoices.items`
 * (Spec 11 follow-up) we fall back to "Others" within the appropriate
 * bucket. Credit notes flip the prefix to 3/4 so VAT reversals are
 * categorised correctly.
 */
const SUBCATEGORY_GOODS = 199999;
const SUBCATEGORY_SERVICES = 299999;
const SUBCATEGORY_CREDIT_GOODS = 399999;
const SUBCATEGORY_CREDIT_SERVICES = 499999;

const VAT_NUMBER_PATTERN = /^\d{9}$/;
const USER_NAME_MAX_LEN = 25;
const CUSTOMER_NAME_MAX_LEN = 25;
const INVOICE_NOTE_MAX_LEN = 100;
const INVOICE_REFERENCE_NUMBER_MAX_LEN = 20;
const INVOICE_ID_MAX_LEN = 50;

/**
 * The `invoice_id` the ITA knows a document by.
 *
 * Exported because the decision service (§4) keys on the id the clearance
 * request registered and must produce a byte-identical value — the spec
 * lowercases every v2 input field (§1.1.2), so a raw formatted number
 * would never match and every decision would answer 463 "No matching
 * unapproved invoice found". Two copies of this rule is how they drift.
 */
export function shaamInvoiceId(formattedNumber: string): string {
  return truncate(formattedNumber.trim().toLowerCase(), INVOICE_ID_MAX_LEN);
}

export interface BuildShaamPayloadInput {
  invoice: {
    id: string;
    formattedNumber: string;
    documentType: DocumentType;
    invoiceDate: string;
    items: OutboundLineItem[];
    subtotal: string | number;
    vatRate: string | number | null;
    vatAmount: string | number | null;
    total: string | number;
    currency: string | null;
    /**
     * Optional notes printed on the document. Truncated to A100 per
     * the spec; HTML stripped to plain text by the caller.
     */
    notes?: string | null;
    /**
     * Route B (action 3): the number of the refused invoice this one
     * replaces. The request is about the item the ITA already holds, so
     * `invoice_id` is the refused invoice's, while
     * `invoice_reference_number` is this invoice's own new number — "a
     * zero-rate invoice will receive a reference number in accordance
     * with the accepted rules" (spec §2.2.2).
     */
    replacesFormattedNumber?: string | null;
  };
  businessEntity: {
    /** 9-digit issuer ID (osek murshe / ח.פ. / ע.ר.). Required. */
    osekMurshe: string | null;
  };
  /** The InvoLoops user who triggered the issuance — populates `user_id` / `user_name`. */
  actor?: {
    /** ע.מ / ח.פ — sent as `user_id`. Optional; spec requires one of `user_id`/`user_name`. */
    taxId?: string | null;
    /** Login email — sent as `user_name` (truncated to 25 chars). */
    email?: string | null;
  };
  customer: {
    taxId: string | null;
    name: string | null;
    address: string | null;
  } | null;
  reference?: {
    originalFormattedNumber: string;
    originalAllocationNumber: string | null;
  };
  actionCode: ShaamActionCode;
  /**
   * 9-digit `accounting_software_number` (Table 2.1 item 15). Pre-Form-513
   * approval the spec lets us substitute the software house's company
   * VAT number — the orchestrator passes that fallback in.
   */
  accountingSoftwareNumber: string;
  /**
   * Issuance timestamp — the moment the document transitioned out of
   * `draft`. Spec field 13 is "automatic, system-generated, cannot be
   * changed by the user". Defaults to "now" when the orchestrator
   * doesn't pass a value.
   */
  issuanceDate?: Date;
}

export function buildShaamPayload(
  input: BuildShaamPayloadInput,
): ShaamInvoicePayload {
  const {
    invoice,
    businessEntity,
    customer,
    reference,
    actionCode,
    actor,
    accountingSoftwareNumber,
    issuanceDate,
  } = input;

  if (!businessEntity.osekMurshe) {
    throw new Error(
      "buildShaamPayload: business entity has no osekMurshe — ITA requires the issuer's 9-digit Authorized Dealer Number.",
    );
  }
  const issuerVat = parseN9(businessEntity.osekMurshe, "vat_number");
  const acctSwNumber = parseN9(
    accountingSoftwareNumber,
    "accounting_software_number",
  );

  const isCredit = invoice.documentType === "CREDIT_INVOICE";
  const vatRateNumber = parseRate(invoice.vatRate);

  // Credit notes carry negative totals locally; ITA v2.0 expects the
  // absolute amount with `invoice_type=330` signalling it's a credit.
  const subtotalAbs = absMoney(invoice.subtotal);
  const vatAbs = absMoney(invoice.vatAmount ?? 0);
  const totalAbs = absMoney(invoice.total);

  if (actionCode === 3 && !invoice.replacesFormattedNumber) {
    throw new Error(
      "buildShaamPayload: action 3 (reverse charge after a refusal) needs the refused invoice's number — its invoice_id is the one the ITA refused.",
    );
  }
  if (actionCode !== 3 && invoice.replacesFormattedNumber) {
    throw new Error(
      "buildShaamPayload: only an action-3 request is sent under the refused invoice's invoice_id.",
    );
  }
  const invoiceIdentifier = shaamInvoiceId(
    invoice.replacesFormattedNumber ?? invoice.formattedNumber,
  );

  const invoiceIssuanceDate = formatDateYmd(issuanceDate ?? new Date());

  const payload: ShaamInvoicePayload = {
    invoice_id: invoiceIdentifier,
    invoice_type: INVOICE_TYPE_CODE[invoice.documentType] ?? 305,
    vat_number: issuerVat,
    invoice_reference_number: lowerTrim(
      truncate(invoice.formattedNumber, INVOICE_REFERENCE_NUMBER_MAX_LEN),
    ),
    invoice_date: invoice.invoiceDate,
    invoice_issuance_date: invoiceIssuanceDate,
    accounting_software_number: acctSwNumber,
    amount_before_discount: parseMoney(subtotalAbs),
    discount: 0,
    payment_amount: parseMoney(subtotalAbs),
    vat_amount: parseMoney(vatAbs),
    payment_amount_including_vat: parseMoney(totalAbs),
    items: invoice.items.map((line) =>
      buildLine(line, vatRateNumber, isCredit),
    ),
  };

  // Operator identity. At least one of user_id / user_name must be
  // present — `submitDocumentToShaam` always supplies the actor's
  // email and is responsible for resolving the actor's tax-id when
  // available (1:1 with `business_entities.osekMurshe` today).
  const actorTaxId = actor?.taxId?.trim();
  if (actorTaxId && VAT_NUMBER_PATTERN.test(actorTaxId)) {
    payload.user_id = Number(actorTaxId);
  }
  const actorName = formatUserName(actor?.email ?? null);
  if (actorName) payload.user_name = actorName;

  // Customer fields — `customer_vat_number` is only emitted when the
  // customer's taxId is a clean 9-digit string (the field is N9, not
  // free-form). `customer_name` is A25, lowercased per v2 rule.
  const customerTaxId = customer?.taxId?.trim();
  if (customerTaxId && VAT_NUMBER_PATTERN.test(customerTaxId)) {
    payload.customer_vat_number = Number(customerTaxId);
  }
  if (customer?.name) {
    const name = lowerTrim(truncate(customer.name, CUSTOMER_NAME_MAX_LEN));
    if (name) payload.customer_name = name;
  }

  if (invoice.notes) {
    const note = lowerTrim(truncate(invoice.notes, INVOICE_NOTE_MAX_LEN));
    if (note) payload.invoice_note = note;
  }

  // `action` is CM — only emitted for codes 3 (reverse charge) and
  // 4 (proforma → tax invoice). Codes 1/2 are kept as historical
  // markers in the orchestrator but are not sent on the wire.
  if (actionCode === 3 || actionCode === 4) {
    payload.action = actionCode;
  }

  if (reference) {
    payload.reference_invoice_id = lowerTrim(
      truncate(
        reference.originalFormattedNumber,
        INVOICE_REFERENCE_NUMBER_MAX_LEN,
      ),
    );
    if (reference.originalAllocationNumber) {
      payload.reference_allocation_number = reference.originalAllocationNumber;
    }
  }

  return payload;
}

function buildLine(
  line: OutboundLineItem,
  vatRateNumber: number,
  isCredit: boolean,
): ShaamLine {
  const qty = Math.abs(line.quantity);
  const unit = Math.abs(line.unitPrice);
  const gross = qty * unit;
  const vatAmount = round2(gross * (vatRateNumber / 100));
  const description = lowerTrim(truncate(line.description, 30));
  const isGoods = looksLikeGoods(line.description);
  const subcategory = isCredit
    ? isGoods
      ? SUBCATEGORY_CREDIT_GOODS
      : SUBCATEGORY_CREDIT_SERVICES
    : isGoods
      ? SUBCATEGORY_GOODS
      : SUBCATEGORY_SERVICES;
  return {
    description,
    category: subcategory,
    quantity: round2(qty),
    price_per_unit: round2(unit),
    total_amount: round2(gross),
    vat_rate: vatRateNumber,
    vat_amount: vatAmount,
  };
}

function looksLikeGoods(description: string): boolean {
  const d = description.toLowerCase();
  return /\b(item|goods|product|units?|pcs|qty)\b/.test(d);
}

function absMoney(value: string | number): string {
  const s = formatMoney(value);
  return s.startsWith("-") ? negateMoney(s) : s;
}

function parseMoney(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`buildShaamPayload: non-numeric money value ${value}`);
  }
  return round2(n);
}

function parseRate(value: string | number | null): number {
  if (value == null) return 18;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 18;
  // Some tenants store rate as 0.18; ITA wants 18. Normalize when the
  // value is clearly a 0..1 decimal.
  return n > 0 && n < 1 ? round2(n * 100) : round2(n);
}

function parseN9(raw: string, fieldName: string): number {
  const cleaned = String(raw).trim();
  if (!VAT_NUMBER_PATTERN.test(cleaned)) {
    throw new Error(
      `buildShaamPayload: ${fieldName} must be a 9-digit number, got "${raw}".`,
    );
  }
  return Number(cleaned);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function lowerTrim(s: string): string {
  return s.trim().toLowerCase();
}

function formatDateYmd(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Pick a sensible 25-char `user_name` from the operator's email.
 *
 * The spec allows A25 free text. Most internal email addresses fit;
 * for very long ones we drop the domain to preserve the recognisable
 * local part. Always lowercased per the v2 rule.
 */
function formatUserName(email: string | null): string | null {
  if (!email) return null;
  const lower = email.trim().toLowerCase();
  if (!lower) return null;
  if (lower.length <= USER_NAME_MAX_LEN) return lower;
  const at = lower.indexOf("@");
  const local = at > 0 ? lower.slice(0, at) : lower;
  return local.length <= USER_NAME_MAX_LEN
    ? local
    : local.slice(0, USER_NAME_MAX_LEN);
}

/**
 * Deterministic idempotency key. Same (businessEntity, document,
 * action, version) → same key; ITA returns the cached response on
 * retries. Bumping the invoice `version` after a REJECTED response
 * produces a fresh key so a corrective resubmission is accepted.
 */
export function computeIdempotencyKey(input: {
  businessEntityId: string;
  documentId: string;
  actionCode: ShaamActionCode;
  version: number;
}): string {
  const canonical = canonicalJson({
    actionCode: input.actionCode,
    businessEntityId: input.businessEntityId,
    documentId: input.documentId,
    version: input.version,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function computePayloadHash(payload: ShaamInvoicePayload): string {
  const canonical = canonicalJson(payload as unknown as Record<string, unknown>);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
