/**
 * Manual verification harness for Spec 08 SHAAM clearance
 * (pure / mock-only — no real ITA traffic).
 *
 * Run: `npx tsx scripts/verify-shaam-submission.ts`
 *
 * Scenarios:
 *   1. Threshold — 6 cases across boundary + override + currency.
 *   2. Payload determinism — same inputs → byte-identical JSON.
 *   3. Idempotency key — stable for same (entity, doc, action,
 *      version); changes when version bumps.
 *   4. Client APPROVED path — fetch stub returns 200 + allocation.
 *   5. Client REJECTED path — stub 400, result=REJECTED with code.
 *   6. Client HELD path — stub 409, result=HELD with deadline.
 *  6b. Hearing deadline parsed from both hold shapes (460 body + 409).
 *  6c. Decision service (§4) — Continue accepted, 463 surfaced.
 *  6d. invoice_id parity between the clearance and decision payloads.
 *   7. Client TIMEOUT path — stub AbortError, result=TIMEOUT.
 *   8. Client allocation extraction — field + regex fallback.
 *   9. 401 → ShaamAuthorizationError thrown.
 *  10. Payload builder — credit note reference block.
 */

import {
  addMoney,
  subtractMoney,
  formatMoney,
  negateMoney,
} from "@/lib/money";
import {
  requiresAllocation,
  getThresholdForDate,
  NO_OBLIGATION_REASONS,
} from "@/lib/shaam/thresholds";
import {
  classifyShaamRejection,
  type ShaamRejectionClassification,
} from "@/lib/shaam/rejection-options";
import {
  buildShaamPayload,
  computeIdempotencyKey,
  computePayloadHash,
  shaamInvoiceId,
} from "@/lib/shaam/payload";
import {
  submitInvoice,
  _setShaamFetchForTests,
  type FetchImpl,
} from "@/lib/shaam/client";
import { ShaamAuthorizationError } from "@/lib/shaam/errors";
import { customerTaxIdBlocksIssue } from "@/lib/shaam/customer-tax-id";
import { allocationAmountsIls, ilsPayloadAmounts } from "@/lib/shaam/allocation-amounts";
import { submitDecision } from "@/lib/shaam/decision";

process.env.SHAAM_CLIENT_ID ||= "stub-client";
process.env.SHAAM_CLIENT_SECRET ||= "stub-secret";
process.env.SHAAM_REDIRECT_URI ||= "http://localhost:3000/api/shaam/oauth/callback";
process.env.SHAAM_BASE_URL_UAT ||= "https://openapi.uat.taxes.gov.il";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function stubFetch(
  responses: Array<{ status?: number; body: unknown; headers?: Record<string, string>; delayMs?: number }>,
): { fetchImpl: FetchImpl; calls: () => number } {
  let i = 0;
  const fetchImpl: FetchImpl = async (_url, init) => {
    const next = responses[i] ?? responses[responses.length - 1];
    i += 1;
    if (next.delayMs) {
      await new Promise((res, rej) => {
        const timer = setTimeout(res, next.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("aborted");
          err.name = "AbortError";
          rej(err);
        });
      });
    }
    const body = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(body, {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...(next.headers ?? {}) },
    });
  };
  return { fetchImpl, calls: () => i };
}

// --- 1. thresholds --------------------------------------------------------

function scenarioThresholds() {
  const name = "1. thresholds — boundary + currency + osek_murshe rules";
  const r1 = requiresAllocation({
    issueDate: new Date("2026-04-20T00:00:00Z"),
    preVatAmount: "9999.99",
    currency: "ILS",
    customerIsOsekMurshe: true,
  });
  const r2 = requiresAllocation({
    issueDate: new Date("2026-04-20T00:00:00Z"),
    preVatAmount: "10000.00",
    currency: "ILS",
    customerIsOsekMurshe: true,
  });
  const r3 = requiresAllocation({
    issueDate: new Date("2026-07-01T00:00:00Z"),
    preVatAmount: "5000.00",
    currency: "ILS",
    customerIsOsekMurshe: true,
  });
  const r4 = requiresAllocation({
    issueDate: new Date("2026-04-20T00:00:00Z"),
    preVatAmount: "20000.00",
    currency: "USD",
    customerIsOsekMurshe: true,
  });
  const r5 = requiresAllocation({
    issueDate: new Date("2026-04-20T00:00:00Z"),
    preVatAmount: "20000.00",
    currency: "ILS",
    customerIsOsekMurshe: false,
  });
  const r6 = requiresAllocation({
    issueDate: new Date("2023-01-01T00:00:00Z"),
    preVatAmount: "1000000.00",
    currency: "ILS",
    customerIsOsekMurshe: true,
  });
  const ok =
    !r1.required &&
    r1.reason === "below_threshold" &&
    r2.required === true &&
    r3.required === true &&
    !r4.required &&
    r4.reason === "foreign_currency" &&
    !r5.required &&
    r5.reason === "no_customer_tax_id" &&
    !r6.required &&
    r6.reason === "pre_threshold_date" &&
    getThresholdForDate(new Date("2026-07-01T00:00:00Z")) === 5000;
  record(
    name,
    ok,
    `r1=${JSON.stringify(r1)} r3=${JSON.stringify(r3)} r4=${JSON.stringify(r4)}`,
  );
}

// --- 2. payload determinism -----------------------------------------------

function scenarioPayloadDeterminism() {
  const name = "2. payload — deterministic for same invoice";
  // Pin the issuance date so two runs produce byte-identical JSON;
  // the production builder uses `new Date()` when `issuanceDate` is
  // omitted, which would otherwise drift between calls.
  const input = {
    invoice: {
      id: "11111111-1111-1111-1111-111111111111",
      formattedNumber: "2026-TI-000001",
      documentType: "TAX_INVOICE" as const,
      invoiceDate: "2026-04-20",
      items: [
        { description: "Widget", quantity: 2, unitPrice: 500, total: 1000 },
      ],
      subtotal: "1000.00",
      vatRate: "18",
      vatAmount: "180.00",
      total: "1180.00",
      currency: "ILS",
    },
    businessEntity: { osekMurshe: "123456789" },
    actor: { taxId: "123456789", email: "actor@example.com" },
    customer: {
      taxId: "987654321",
      name: "ACME LTD",
      address: "1 Rothschild, Tel Aviv",
    },
    actionCode: 1 as const,
    accountingSoftwareNumber: "517193777",
    issuanceDate: new Date("2026-04-20T08:00:00Z"),
  };
  const a = JSON.stringify(buildShaamPayload(input));
  const b = JSON.stringify(buildShaamPayload(input));
  record(name, a === b, `len=${a.length}`);
}

// --- 3. idempotency key ---------------------------------------------------

function scenarioIdempotency() {
  const name = "3. idempotency — stable for same inputs, diverges on version";
  const a1 = computeIdempotencyKey({
    businessEntityId: "ent-1",
    documentId: "doc-1",
    actionCode: 1,
    version: 1,
  });
  const a2 = computeIdempotencyKey({
    businessEntityId: "ent-1",
    documentId: "doc-1",
    actionCode: 1,
    version: 1,
  });
  const b = computeIdempotencyKey({
    businessEntityId: "ent-1",
    documentId: "doc-1",
    actionCode: 1,
    version: 2,
  });
  record(name, a1 === a2 && a1 !== b, `a=${a1.slice(0, 10)} b=${b.slice(0, 10)}`);
}

// --- 4. APPROVED ----------------------------------------------------------

async function scenarioApproved() {
  const name = "4. APPROVED — 200 + approved:true + confirmation_number";
  // v2 shape: approved=true + 25-digit confirmation_number (Israel
  // Invoice Model 7/2024 §2.3).
  const stub = stubFetch([
    {
      status: 200,
      body: {
        status: 200,
        message: "Invoice approved",
        confirmation_number: "20240627231846297178091822",
        approved: true,
      },
      headers: { "x-correlation-id": "req-abc" },
    },
  ]);
  _setShaamFetchForTests(stub.fetchImpl);
  try {
    const result = await submitInvoice({
      accessToken: "stub-access",
      payload: makePayload(),
      idempotencyKey: "k1",
      correlationId: "c1",
      timeoutMs: 5_000,
    });
    record(
      name,
      result.result === "APPROVED" &&
        result.allocationNumber === "20240627231846297178091822",
      result.result === "APPROVED"
        ? `alloc=${result.allocationNumber} reqId=${result.requestId}`
        : `result=${result.result}`,
    );
  } finally {
    _setShaamFetchForTests(undefined);
  }
}

// --- 5. REJECTED ----------------------------------------------------------

async function scenarioRejected() {
  const name = "5. REJECTED — 400 with v2 nested errors[]";
  // v2 wraps validation errors under message.errors[]. Spec example
  // §2.3 — code 434 = "Invoice date is too old for approval".
  const stub = stubFetch([
    {
      status: 400,
      body: {
        status: 400,
        message: {
          errors: [
            {
              code: 434,
              message: "Invoice date is too old for approval",
              param: "invoice_date",
              location: "request",
            },
          ],
        },
        confirmation_number: "0",
        approved: false,
      },
    },
  ]);
  _setShaamFetchForTests(stub.fetchImpl);
  try {
    const result = await submitInvoice({
      accessToken: "stub",
      payload: makePayload(),
      idempotencyKey: "k2",
      correlationId: "c2",
      timeoutMs: 5_000,
    });
    record(
      name,
      result.result === "REJECTED" && result.errorCode === "434",
      result.result === "REJECTED"
        ? `code=${result.errorCode} msg=${result.errorMessage}`
        : `result=${result.result}`,
    );
  } finally {
    _setShaamFetchForTests(undefined);
  }
}

// --- 6. HELD --------------------------------------------------------------

async function scenarioHeld() {
  const name = "6. HELD — 200 + approved:false + code 460 (held for review)";
  // v2 returns 200 OK for soft rejections; the body's `approved`
  // boolean discriminates. Code 460 = "Invoice not approved" (held,
  // hearing decision pending).
  const stub = stubFetch([
    {
      status: 200,
      body: {
        status: 200,
        message: {
          errors: [
            {
              code: 460,
              message: "Invoice not approved",
              param: "vat_number",
              location: "approval",
            },
          ],
        },
        confirmation_number: "0",
        approved: false,
      },
    },
  ]);
  _setShaamFetchForTests(stub.fetchImpl);
  try {
    const result = await submitInvoice({
      accessToken: "stub",
      payload: makePayload(),
      idempotencyKey: "k3",
      correlationId: "c3",
      timeoutMs: 5_000,
    });
    record(
      name,
      result.result === "HELD" && result.errorCode === "460",
      result.result === "HELD"
        ? `code=${result.errorCode} msg=${result.errorMessage}`
        : `result=${result.result}`,
    );
  } finally {
    _setShaamFetchForTests(undefined);
  }
}

// --- 6b. HELD carries the hearing deadline ---------------------------------

/**
 * The deadline used to be read only out of a 409 body; a 460/461 hold
 * hardcoded null and the value was then dropped on the floor anyway.
 * Both hold shapes must now surface it, in either spelling.
 */
async function scenarioHearingDeadline() {
  const name = "6b. HELD — hearing deadline parsed from 460 body and from 409";
  const iso = "2026-10-05T09:00:00.000Z";

  const heldFrom460 = stubFetch([
    {
      status: 200,
      body: {
        status: 200,
        message: {
          errors: [{ code: 460, message: "Invoice not approved" }],
        },
        approved: false,
        hearing_deadline: iso,
      },
    },
  ]);
  _setShaamFetchForTests(heldFrom460.fetchImpl);
  let from460: Date | null = null;
  try {
    const result = await submitInvoice({
      accessToken: "stub",
      payload: makePayload(),
      idempotencyKey: "k3b",
      correlationId: "c3b",
      timeoutMs: 5_000,
    });
    if (result.result === "HELD") from460 = result.hearingDeadline;
  } finally {
    _setShaamFetchForTests(undefined);
  }

  const heldFrom409 = stubFetch([
    {
      status: 409,
      body: { errorMessage: "Held", hearingDeadline: iso },
    },
  ]);
  _setShaamFetchForTests(heldFrom409.fetchImpl);
  let from409: Date | null = null;
  try {
    const result = await submitInvoice({
      accessToken: "stub",
      payload: makePayload(),
      idempotencyKey: "k3c",
      correlationId: "c3c",
      timeoutMs: 5_000,
    });
    if (result.result === "HELD") from409 = result.hearingDeadline;
  } finally {
    _setShaamFetchForTests(undefined);
  }

  const ok =
    from460?.toISOString() === iso && from409?.toISOString() === iso;
  record(
    name,
    ok,
    `from460=${from460?.toISOString() ?? "null"} from409=${from409?.toISOString() ?? "null"}`,
  );
}

// --- 6c. Decision service (spec §4) ---------------------------------------

/**
 * The decision-update service must be told which of the four statutory
 * alternatives the seller chose. Three of the four route here; reverse
 * charge goes through the Approval service instead.
 */
async function scenarioDecisionService() {
  const name = "6c. decision service — Continue accepted, and 463 surfaced";

  const accepted = stubFetch([
    { status: 200, body: { status: 200, message: "Decision accepted" } },
  ]);
  _setShaamFetchForTests(accepted.fetchImpl);
  let okResult: string | null = null;
  try {
    const r = await submitDecision({
      accessToken: "stub",
      decision: "Continue",
      payload: { invoice_id: "2026-TI-000001", vat_number: 123456789 },
      correlationId: "d1",
      timeoutMs: 5_000,
    });
    okResult = r.result;
  } finally {
    _setShaamFetchForTests(undefined);
  }

  // §4.2 documents 463 "No matching unapproved invoice found" for a
  // decision that does not correspond to a held invoice.
  const refused = stubFetch([
    {
      status: 400,
      body: {
        status: 400,
        message: {
          errors: [
            {
              code: 463,
              message: "No matching unapproved invoice found",
              param: "invoice_id",
              location: "request",
            },
          ],
        },
      },
    },
  ]);
  _setShaamFetchForTests(refused.fetchImpl);
  let errCode: string | null = null;
  try {
    const r = await submitDecision({
      accessToken: "stub",
      decision: "Cancel",
      payload: { invoice_id: "2026-TI-000002", vat_number: 123456789 },
      correlationId: "d2",
      timeoutMs: 5_000,
    });
    if (r.result === "REJECTED") errCode = r.errorCode;
  } finally {
    _setShaamFetchForTests(undefined);
  }

  record(
    name,
    okResult === "ACCEPTED" && errCode === "463",
    `accepted=${okResult} refusedCode=${errCode}`,
  );
}

// --- 6d. invoice_id parity between clearance and decision ------------------

/**
 * The decision service matches on the id the clearance request
 * registered. The spec lowercases every v2 input field, so a raw
 * formatted number sent to the decision endpoint would never match and
 * every decision would answer 463. Both paths must derive the id the
 * same way — hence one shared `shaamInvoiceId`.
 */
function scenarioInvoiceIdParity() {
  const name = "6d. invoice_id — clearance payload and shaamInvoiceId agree";
  const formatted = "2026-TI-000042";
  const payload = buildShaamPayload({
    invoice: {
      id: "doc-parity",
      formattedNumber: formatted,
      documentType: "TAX_INVOICE",
      invoiceDate: "2026-09-01",
      items: [{ description: "x", quantity: 1, unitPrice: 100, total: 100 }],
      subtotal: "100",
      vatRate: "18",
      vatAmount: "18",
      total: "118",
      currency: "ILS",
      notes: null,
    },
    businessEntity: { osekMurshe: "123456789" },
    actor: { taxId: "123456789", email: "a@b.co" },
    customer: { taxId: "987654321", name: "c", address: null },
    actionCode: 1,
    accountingSoftwareNumber: "123456789",
  });
  const shared = shaamInvoiceId(formatted);
  record(
    name,
    payload.invoice_id === shared && shared === formatted.toLowerCase(),
    `clearance=${payload.invoice_id} shared=${shared}`,
  );
}

function scenarioReverseChargeReplacementId() {
  // Route B: the replacement asks under the REFUSED invoice's Invoice_Id,
  // and reports its own new number as the reference number.
  const base = {
    id: "doc-replacement",
    formattedNumber: "2026-TI-000100",
    documentType: "TAX_INVOICE" as const,
    invoiceDate: "2026-09-01",
    items: [{ description: "x", quantity: 1, unitPrice: 100, total: 100 }],
    subtotal: "100",
    vatRate: "0",
    vatAmount: "0",
    total: "100",
    currency: "ILS",
    notes: null,
  };
  const common = {
    businessEntity: { osekMurshe: "123456789" },
    actor: { taxId: "123456789", email: "a@b.co" },
    customer: { taxId: "987654321", name: "c", address: null },
    accountingSoftwareNumber: "123456789",
  };
  const payload = buildShaamPayload({
    ...common,
    invoice: { ...base, replacesFormattedNumber: "2026-TI-000099" },
    actionCode: 3,
  });
  let missingThrew = false;
  try {
    buildShaamPayload({ ...common, invoice: base, actionCode: 3 });
  } catch {
    missingThrew = true;
  }
  let action1Threw = false;
  try {
    buildShaamPayload({
      ...common,
      invoice: { ...base, replacesFormattedNumber: "2026-TI-000099" },
      actionCode: 1,
    });
  } catch {
    action1Threw = true;
  }
  record(
    "6e. action 3 — invoice_id is the refused invoice's, reference number the replacement's own",
    payload.invoice_id === shaamInvoiceId("2026-TI-000099") &&
      payload.invoice_reference_number === "2026-ti-000100" &&
      payload.vat_amount === 0 &&
      missingThrew &&
      action1Threw,
    `invoice_id=${payload.invoice_id} ref=${payload.invoice_reference_number} missing=${missingThrew} a1=${action1Threw}`,
  );
}

// --- 7. TIMEOUT -----------------------------------------------------------

async function scenarioTimeout() {
  const name = "7. TIMEOUT — abort on slow response";
  const stub = stubFetch([
    {
      status: 200,
      body: {
        approved: true,
        confirmation_number: "20240627231846297178091822",
      },
      delayMs: 2000,
    },
  ]);
  _setShaamFetchForTests(stub.fetchImpl);
  try {
    const result = await submitInvoice({
      accessToken: "stub",
      payload: makePayload(),
      idempotencyKey: "k4",
      correlationId: "c4",
      timeoutMs: 100,
    });
    record(
      name,
      result.result === "TIMEOUT",
      result.result === "TIMEOUT"
        ? `elapsed=${result.elapsedMs}ms`
        : `result=${result.result}`,
    );
  } finally {
    _setShaamFetchForTests(undefined);
  }
}

// --- 8. allocation extraction regex fallback -----------------------------

async function scenarioAllocationRegex() {
  const name = "8. allocation extraction — regex fallback from raw body";
  // approved=true but with the confirmation_number embedded in a free-
  // text field — exercises the regex fallback in extractAllocationNumber.
  // Use a 9-digit number to drive the v1 fallback branch (the v2 25-digit
  // branch is exercised by the APPROVED scenario above).
  const stub = stubFetch([
    {
      status: 200,
      body: { approved: true, message: "OK", approval: "ref 555666777 ok" },
    },
  ]);
  _setShaamFetchForTests(stub.fetchImpl);
  try {
    const result = await submitInvoice({
      accessToken: "stub",
      payload: makePayload(),
      idempotencyKey: "k5",
      correlationId: "c5",
      timeoutMs: 5_000,
    });
    record(
      name,
      result.result === "APPROVED" && result.allocationNumber === "555666777",
      result.result === "APPROVED"
        ? `alloc=${result.allocationNumber}`
        : `result=${result.result}`,
    );
  } finally {
    _setShaamFetchForTests(undefined);
  }
}

// --- 9. 401 throws --------------------------------------------------------

async function scenarioUnauthorized() {
  const name = "9. 401 → ShaamAuthorizationError thrown";
  const stub = stubFetch([
    { status: 401, body: { error: "invalid_token" } },
  ]);
  _setShaamFetchForTests(stub.fetchImpl);
  try {
    let threw = false;
    let reason: string | undefined;
    try {
      await submitInvoice({
        accessToken: "stub",
        payload: makePayload(),
        idempotencyKey: "k6",
        correlationId: "c6",
        timeoutMs: 5_000,
      });
    } catch (err) {
      if (err instanceof ShaamAuthorizationError) {
        threw = true;
        reason = err.reason;
      }
    }
    record(name, threw && reason === "expired", `reason=${reason}`);
  } finally {
    _setShaamFetchForTests(undefined);
  }
}

// --- 10. credit reference block ------------------------------------------

function scenarioCreditReference() {
  const name = "10. payload — credit note carries reference block + invoice_type 330";
  const payload = buildShaamPayload({
    invoice: {
      id: "doc-credit",
      formattedNumber: "2026-CI-000005",
      documentType: "CREDIT_INVOICE",
      invoiceDate: "2026-04-20",
      items: [
        { description: "Refund", quantity: 1, unitPrice: -500, total: -500 },
      ],
      subtotal: "-500.00",
      vatRate: "18",
      vatAmount: "-90.00",
      total: "-590.00",
      currency: "ILS",
    },
    businessEntity: { osekMurshe: "123456789" },
    actor: { taxId: "123456789", email: "actor@example.com" },
    customer: { taxId: "987654321", name: "ACME", address: null },
    reference: {
      originalFormattedNumber: "2026-TI-000042",
      originalAllocationNumber: "111222333",
    },
    actionCode: 1,
    accountingSoftwareNumber: "517193777",
    issuanceDate: new Date("2026-04-20T08:00:00Z"),
  });
  const ok =
    payload.reference_invoice_id === "2026-ti-000042" &&
    payload.reference_allocation_number === "111222333" &&
    payload.payment_amount_including_vat === 590 &&
    payload.invoice_type === 330;
  record(name, ok, `ref=${payload.reference_allocation_number} type=${payload.invoice_type}`);
}

// --- money sanity --------------------------------------------------------

function scenarioMoneyBasics() {
  const name = "11. money basics — reused for credit subtotal sign flip";
  const ok =
    subtractMoney("0", "100.00") === "-100.00" &&
    addMoney("1.23", "4.56") === "5.79" &&
    formatMoney(-0.5) === "-0.50" &&
    negateMoney("-7.25") === "7.25";
  record(name, ok);
}

function makePayload() {
  return buildShaamPayload({
    invoice: {
      id: "doc-1",
      formattedNumber: "2026-TI-000001",
      documentType: "TAX_INVOICE",
      invoiceDate: "2026-04-20",
      items: [
        { description: "Widget", quantity: 1, unitPrice: 1000, total: 1000 },
      ],
      subtotal: "1000.00",
      vatRate: "18",
      vatAmount: "180.00",
      total: "1180.00",
      currency: "ILS",
    },
    businessEntity: { osekMurshe: "123456789" },
    actor: { taxId: "123456789", email: "actor@example.com" },
    customer: null,
    actionCode: 1,
    accountingSoftwareNumber: "517193777",
    issuanceDate: new Date("2026-04-20T08:00:00Z"),
  });
}

// --- HTTP-status classification (spec §5) ---------------------------------

/**
 * The bug this guards: `client.ts` maps every 4xx except 401/409 to
 * REJECTED, and `classifyShaamRejection` only ever looked at the body's
 * error code. So a 422 — our own payload failing their schema — with an
 * unrecognised code fell through to `unknown`, which offers all five
 * statutory options. The seller was invited to demand a hearing at the
 * Tax Authority over a bug in our payload builder.
 */
function scenarioHttpClassification() {
  const cases: Array<{
    name: string;
    input: Parameters<typeof classifyShaamRejection>[0];
    kind: ShaamRejectionClassification["kind"];
    reasonKey: string | null;
    mustOffer?: string[];
    mustNotOffer: string[];
  }> = [
    {
      name: "422 + unrecognised code — ours, not a refusal",
      input: { errorCode: "9999", customerIsOsekMurshe: true, httpStatus: 422 },
      kind: "our_fault",
      reasonKey: "http_422",
      // Nothing on the document is wrong, so there is nothing to fix.
      mustNotOffer: ["hearing", "reverse_charge", "fix_and_retry"],
    },
    {
      name: "422 — a reverse-charge-capable customer does not resurrect the hearing",
      input: { errorCode: null, customerIsOsekMurshe: true, httpStatus: 422 },
      kind: "our_fault",
      reasonKey: "http_422",
      mustNotOffer: ["hearing", "reverse_charge"],
    },
    {
      name: "406 — a permission, nothing adjudicated",
      input: { errorCode: null, customerIsOsekMurshe: true, httpStatus: 406 },
      kind: "permission",
      reasonKey: "http_406",
      mustOffer: ["fix_and_retry"],
      // No hearing: the invoice was never judged. No reverse charge: it
      // may be exactly the permission being refused.
      mustNotOffer: ["hearing", "reverse_charge"],
    },
    {
      name: "400 + unrecognised code — the seller's data, but not contestable",
      input: { errorCode: "9999", customerIsOsekMurshe: true, httpStatus: 400 },
      kind: "validation",
      reasonKey: "http_400",
      mustOffer: ["fix_and_retry"],
      mustNotOffer: ["hearing"],
    },
    {
      name: "400 + code 30 — a recognised body code outranks the status",
      input: { errorCode: "30", customerIsOsekMurshe: true, httpStatus: 400 },
      kind: "validation",
      reasonKey: "code_30",
      mustOffer: ["fix_and_retry"],
      mustNotOffer: ["hearing"],
    },
    {
      name: "200 + 462 — a real refusal still gets the statutory remedies",
      input: { errorCode: "462", customerIsOsekMurshe: true, httpStatus: 200 },
      kind: "administrative",
      reasonKey: "administrative",
      // Reverse charge is one of the statutory remedies, now that §5 is
      // built (route B: consent, action 3, storno, locked zero-rate doc).
      mustOffer: ["hearing", "cancel", "reverse_charge"],
      // `fix_and_retry` because the refusal is on the merits — resubmitting
      // cannot succeed.
      mustNotOffer: ["fix_and_retry"],
    },
    {
      name: "200 + 462, customer without a tax id — no reverse charge",
      input: { errorCode: "462", customerIsOsekMurshe: false, httpStatus: 200 },
      kind: "administrative",
      reasonKey: "administrative",
      mustOffer: ["hearing", "cancel"],
      mustNotOffer: ["reverse_charge"],
    },
    {
      // The shipped behaviour before this fix, and what still happens if a
      // caller cannot supply the status: with only an unrecognised code to
      // go on we cannot tell a bad payload from a refusal, so we stay
      // conservative and keep every door open. That is the right default —
      // and exactly why the status has to be passed when it is known.
      name: "unrecognised code, no status — conservative, every built option",
      input: { errorCode: "9999", customerIsOsekMurshe: true },
      kind: "unknown",
      reasonKey: null,
      mustOffer: ["hearing", "fix_and_retry", "cancel", "reverse_charge"],
      mustNotOffer: [],
    },
    {
      name: "434 — invoice date too old, a data problem not a refusal",
      input: { errorCode: "434", customerIsOsekMurshe: true, httpStatus: 200 },
      kind: "validation",
      reasonKey: "code_434",
      mustOffer: ["fix_and_retry"],
      mustNotOffer: ["hearing", "reverse_charge"],
    },
    {
      name: "462 with no status known — unchanged for callers that pass none",
      input: { errorCode: "462", customerIsOsekMurshe: true },
      kind: "administrative",
      reasonKey: "administrative",
      mustOffer: ["hearing"],
      mustNotOffer: ["fix_and_retry"],
    },
  ];

  for (const c of cases) {
    const got = classifyShaamRejection(c.input);
    const problems: string[] = [];
    if (got.kind !== c.kind) problems.push(`kind=${got.kind} want ${c.kind}`);
    if (got.reasonKey !== c.reasonKey) {
      problems.push(`reasonKey=${got.reasonKey} want ${c.reasonKey}`);
    }
    for (const o of c.mustOffer ?? []) {
      if (!got.options.includes(o as never)) problems.push(`missing ${o}`);
    }
    for (const o of c.mustNotOffer) {
      if (got.options.includes(o as never)) problems.push(`offers ${o}`);
    }
    record(
      `15. ${c.name}`,
      problems.length === 0,
      problems.length === 0 ? got.options.join("+") : problems.join("; "),
    );
  }
}

// --- zero VAT, and "could not ask" vs "not required" ----------------------

/**
 * Two changes here, both driven by the same question: do we ask the ITA for
 * a number we do not need, and what do we tell the seller when we do not?
 *
 * `zero_vat` stops the ask. §1.2 lists "the invoice includes a non-zero VAT
 * component" among the conditions, and the cost of asking anyway is not zero:
 * a refusal of a number nobody needed blocks issuance and offers remedies
 * that do not apply (see spec-audit-v2.md §12.8).
 *
 * `no_customer_tax_id` is the rename. It used to read
 * `no_customer_osek_murshe`, which sounds like an exemption. It is not one —
 * the request needs the customer's 9-digit number and we do not have it. The
 * distinction is what `NO_OBLIGATION_REASONS` encodes.
 */
function scenarioZeroVatAndSkipReasons() {
  const base = {
    issueDate: new Date("2026-04-20T00:00:00Z"),
    preVatAmount: "20000.00",
    currency: "ILS",
    customerIsOsekMurshe: true,
  };

  const zero = requiresAllocation({ ...base, vatAmount: "0.00" });
  record(
    "16. zero VAT above threshold → no request",
    !zero.required && zero.reason === "zero_vat",
    JSON.stringify(zero),
  );

  const withVat = requiresAllocation({ ...base, vatAmount: "3600.00" });
  record(
    "16. non-zero VAT above threshold → request",
    withVat.required === true,
    JSON.stringify(withVat),
  );

  // Absent is not zero. A caller with no figure must fall back to asking:
  // silently skipping clearance on a missing value is the unsafe direction.
  const unknown = requiresAllocation({ ...base, vatAmount: null });
  const omitted = requiresAllocation(base);
  record(
    "16. VAT unknown → still request (absent is not zero)",
    unknown.required === true && omitted.required === true,
    `null=${JSON.stringify(unknown)} omitted=${JSON.stringify(omitted)}`,
  );

  // A credit note carries negative VAT; that is still a VAT component.
  const credit = requiresAllocation({
    ...base,
    preVatAmount: "-20000.00",
    vatAmount: "-3600.00",
  });
  record(
    "16. credit note with negative VAT → request",
    credit.required === true,
    JSON.stringify(credit),
  );

  // The point of the rename: a missing tax id is not an exemption.
  const noTaxId = requiresAllocation({
    ...base,
    customerIsOsekMurshe: false,
    vatAmount: "3600.00",
  });
  const isExemption =
    !noTaxId.required && NO_OBLIGATION_REASONS.includes(noTaxId.reason);
  record(
    "16. missing tax id is 'could not ask', not 'no obligation'",
    !noTaxId.required &&
      noTaxId.reason === "no_customer_tax_id" &&
      !isExemption,
    `reason=${!noTaxId.required ? noTaxId.reason : "required"} classedAsExemption=${isExemption}`,
  );

  const belowThreshold = requiresAllocation({
    ...base,
    preVatAmount: "100.00",
    vatAmount: "18.00",
  });
  record(
    "16. below threshold IS classed as no obligation",
    !belowThreshold.required &&
      NO_OBLIGATION_REASONS.includes(belowThreshold.reason),
    !belowThreshold.required ? belowThreshold.reason : "required",
  );
}

/**
 * An invoice that needs an allocation number must not be issued without a
 * customer number to request it with — and nothing the other conditions
 * already excuse may be blocked for a number it would never have used.
 */
function scenarioCustomerTaxIdGate() {
  const base = {
    documentType: "TAX_INVOICE",
    issueDate: new Date("2026-09-30T00:00:00Z"),
    preVatAmount: "25000.00",
    vatAmount: "4500.00",
    currency: "ILS",
  };
  const cases: Array<[string, Partial<typeof base> & { customerTaxId: string | null }, boolean]> = [
    ["no tax id, above threshold → blocked", { customerTaxId: null }, true],
    ["blank tax id → blocked", { customerTaxId: "  " }, true],
    ["8 digits → blocked", { customerTaxId: "51500000" }, true],
    ["wrong check digit → blocked", { customerTaxId: "515000002" }, true],
    ["valid tax id → allowed", { customerTaxId: "515000008" }, false],
    ["below threshold, no tax id → allowed", { customerTaxId: null, preVatAmount: "1000.00", vatAmount: "180.00" }, false],
    ["zero VAT, no tax id → allowed", { customerTaxId: null, vatAmount: "0.00" }, false],
    ["USD, no tax id → allowed", { customerTaxId: null, currency: "USD" }, false],
    ["receipt, no tax id → allowed", { customerTaxId: null, documentType: "RECEIPT" }, false],
    ["tax invoice-receipt, no tax id → blocked", { customerTaxId: null, documentType: "TAX_INVOICE_RECEIPT" }, true],
  ];
  const wrong = cases.filter(
    ([, over, expected]) => customerTaxIdBlocksIssue({ ...base, ...over }) !== expected,
  );
  record(
    "17. customer tax-id gate blocks issue only when an allocation would be owed",
    wrong.length === 0,
    wrong.length ? `wrong: ${wrong.map(([n]) => n).join("; ")}` : `${cases.length} cases`,
  );
}

/**
 * Foreign currency (accountant, 2026-10): the allocation obligation is tested
 * on the ILS value at the document's frozen Bank of Israel rate, and the ITA
 * is sent ILS amounts — it has no currency field.
 */
function scenarioForeignCurrency() {
  const usd = {
    documentType: "TAX_INVOICE",
    currency: "USD",
    subtotal: "2000.00",
    vatAmount: "360.00",
    total: "2360.00",
    fxRateToIls: "3.700000",
    items: [{ description: "Consulting", quantity: 2, unitPrice: 1000, total: 2000 }],
  };
  const amounts = allocationAmountsIls(usd);
  const decision = requiresAllocation({
    issueDate: new Date("2026-09-30T00:00:00Z"),
    preVatAmount: amounts.preVatAmount,
    currency: amounts.currency,
    customerIsOsekMurshe: true,
    vatAmount: amounts.vatAmount,
  });
  record(
    "18a. USD 2,000 at 3.7 = ILS 7,400 → allocation required (was skipped as foreign_currency)",
    amounts.preVatAmount === "7400.00" && amounts.vatAmount === "1332.00" && decision.required,
    `${amounts.preVatAmount}/${amounts.vatAmount} required=${decision.required}`,
  );

  const small = allocationAmountsIls({ ...usd, subtotal: "1000.00", vatAmount: "180.00", total: "1180.00" });
  const smallDecision = requiresAllocation({
    issueDate: new Date("2026-09-30T00:00:00Z"),
    preVatAmount: small.preVatAmount,
    currency: small.currency,
    customerIsOsekMurshe: true,
    vatAmount: small.vatAmount,
  });
  record(
    "18b. USD 1,000 at 3.7 = ILS 3,700 → below the threshold",
    !smallDecision.required && !smallDecision.required && smallDecision.reason === "below_threshold",
    !smallDecision.required ? smallDecision.reason : "required",
  );

  const credit = allocationAmountsIls({ ...usd, documentType: "CREDIT_INVOICE", subtotal: "-2000.00", vatAmount: "-360.00", total: "-2360.00" });
  record("18c. credit note → negative ILS pre-VAT amount", credit.preVatAmount === "-7400.00", credit.preVatAmount);

  const p = ilsPayloadAmounts(usd);
  record(
    "18d. payload money in ILS at the frozen rate, lines converted",
    p.currency === "ILS" && p.subtotal === "7400.00" && p.vatAmount === "1332.00" &&
      p.total === "8732.00" && Math.abs(p.items[0].unitPrice - 3700) < 1e-9 && p.items[0].total === 7400,
    `${p.subtotal}/${p.vatAmount}/${p.total} unit=${p.items[0].unitPrice}`,
  );

  const ils = ilsPayloadAmounts({ ...usd, currency: "ILS", fxRateToIls: null });
  record("18e. ILS document → payload unchanged", ils.subtotal === "2000.00" && ils.rate === 1 && ils.items[0].unitPrice === 1000);
}

async function main() {
  console.log("[verify-shaam-submission] starting…\n");
  const scenarios: Array<[string, () => Promise<void> | void]> = [
    ["thresholds", scenarioThresholds],
    ["payloadDeterminism", scenarioPayloadDeterminism],
    ["idempotency", scenarioIdempotency],
    ["approved", scenarioApproved],
    ["rejected", scenarioRejected],
    ["held", scenarioHeld],
    ["hearing-deadline", scenarioHearingDeadline],
    ["decision-service", scenarioDecisionService],
    ["invoice-id-parity", scenarioInvoiceIdParity],
    ["reverse-charge-replacement-id", scenarioReverseChargeReplacementId],
    ["timeout", scenarioTimeout],
    ["allocationRegex", scenarioAllocationRegex],
    ["unauthorized", scenarioUnauthorized],
    ["creditReference", scenarioCreditReference],
    ["moneyBasics", scenarioMoneyBasics],
    ["httpClassification", scenarioHttpClassification],
    ["zeroVatAndSkipReasons", scenarioZeroVatAndSkipReasons],
    ["customerTaxIdGate", scenarioCustomerTaxIdGate],
    ["foreignCurrency", scenarioForeignCurrency],
  ];
  for (const [label, fn] of scenarios) {
    try {
      await fn();
    } catch (err) {
      record(label, false, err instanceof Error ? err.message : String(err));
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n[verify-shaam-submission] ${passed}/${total} passed`);
  // Silence unused-imports when a scenario doesn't exercise them.
  void computePayloadHash;
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-shaam-submission] fatal:", err);
  process.exit(1);
});
