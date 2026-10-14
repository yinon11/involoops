/**
 * Manual verification harness for Spec 06 credit-note domain rules.
 *
 * Run: `npx tsx scripts/verify-credit-notes.ts`
 *
 * This harness exercises the PURE validation logic + decimal-string
 * money math. The end-to-end `issueCreditNote` flow depends on
 * signing-key bootstrap AND S3 availability (archive), so full flows
 * are covered by the integration path (detail page + credit form) and
 * not re-run here — keeping this script dependency-free so it can run
 * in any local env.
 *
 * Scenarios exercised here:
 *   1. Full credit (linkType === CREDIT_REVERSES, remainingAfter = 0).
 *   2. Partial credit (linkType === CREDIT_PARTIAL, remainingAfter
 *      calculated).
 *   3. Sequential partials — three validations against a manually-
 *      decreasing remaining balance, last one fails amount_exceeds.
 *   4. Over-credit rejected (amount > remaining).
 *   5. Draft rejected.
 *   6. Credit note as original rejected (wrong_document_type).
 *   7. Cross-tenant rejected.
 *   8. Reason too short.
 *   9. Money arithmetic — addMoney, subtractMoney, compareMoney,
 *      negateMoney on strings round-trip correctly without float drift.
 */

import { validateCreditNoteRequest } from "@/lib/documents/credit-notes";
import {
  addMoney,
  subtractMoney,
  compareMoney,
  negateMoney,
} from "@/lib/money";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const ENTITY_A = "00000000-0000-0000-0000-00000000000a";
const ENTITY_B = "00000000-0000-0000-0000-00000000000b";

function mkOriginal(overrides: {
  documentType?: "TAX_INVOICE" | "CREDIT_INVOICE" | "RECEIPT";
  status?: string;
  total?: string;
  net?: string | null;
  entity?: string;
} = {}) {
  return {
    id: "00000000-0000-0000-0000-00000000dead",
    businessEntityId: overrides.entity ?? ENTITY_A,
    documentType: (overrides.documentType ?? "TAX_INVOICE") as import("@/lib/documents/types").DocumentType,
    status: overrides.status ?? "issued",
    total: overrides.total ?? "1000.00",
    netOfCreditsAmount: overrides.net ?? overrides.total ?? "1000.00",
  };
}

function scenarioFullCredit() {
  const result = validateCreditNoteRequest({
    original: mkOriginal({ total: "1000.00", net: "1000.00" }),
    actingBusinessEntityId: ENTITY_A,
    creditAmount: "1000.00",
    reason: "customer returned goods",
  });
  record(
    "1. full credit → CREDIT_REVERSES, remainingAfter=0.00",
    result.valid &&
      result.linkType === "CREDIT_REVERSES" &&
      result.remainingAfter === "0.00",
    JSON.stringify(result),
  );
}

function scenarioPartialCredit() {
  const result = validateCreditNoteRequest({
    original: mkOriginal({ total: "1000.00", net: "1000.00" }),
    actingBusinessEntityId: ENTITY_A,
    creditAmount: "400.00",
    reason: "partial refund for item qty error",
  });
  record(
    "2. partial credit → CREDIT_PARTIAL, remainingAfter=600.00",
    result.valid &&
      result.linkType === "CREDIT_PARTIAL" &&
      result.remainingAfter === "600.00",
    JSON.stringify(result),
  );
}

function scenarioSequentialPartials() {
  let remaining = "1000.00";
  const amounts = ["300.00", "500.00", "200.00"];
  const outcomes: string[] = [];
  for (const amount of amounts) {
    const r = validateCreditNoteRequest({
      original: mkOriginal({ total: "1000.00", net: remaining }),
      actingBusinessEntityId: ENTITY_A,
      creditAmount: amount,
      reason: "sequential partial credits test",
    });
    if (!r.valid) {
      outcomes.push(`FAIL ${r.error}`);
      break;
    }
    outcomes.push(`${r.linkType} leaves ${r.remainingAfter}`);
    remaining = r.remainingAfter;
  }
  const ok =
    outcomes.length === 3 &&
    outcomes[0] === "CREDIT_PARTIAL leaves 700.00" &&
    outcomes[1] === "CREDIT_PARTIAL leaves 200.00" &&
    outcomes[2] === "CREDIT_REVERSES leaves 0.00";
  record("3. sequential partials sum to full credit", ok, outcomes.join(" | "));
}

function scenarioOverCredit() {
  const r = validateCreditNoteRequest({
    original: mkOriginal({ total: "1000.00", net: "400.00" }),
    actingBusinessEntityId: ENTITY_A,
    creditAmount: "500.00",
    reason: "deliberate over-credit for test",
  });
  record(
    "4. over-credit rejected",
    !r.valid && r.error === "amount_exceeds_remaining",
    JSON.stringify(r),
  );
}

function scenarioDraftRejected() {
  const r = validateCreditNoteRequest({
    original: mkOriginal({ status: "draft" }),
    actingBusinessEntityId: ENTITY_A,
    creditAmount: "100.00",
    reason: "cannot credit a draft invoice",
  });
  record(
    "5. draft cannot be credited",
    !r.valid && r.error === "draft_cannot_be_credited",
    JSON.stringify(r),
  );
}

function scenarioCreditNoteAsOriginal() {
  const r = validateCreditNoteRequest({
    original: mkOriginal({ documentType: "CREDIT_INVOICE" }),
    actingBusinessEntityId: ENTITY_A,
    creditAmount: "100.00",
    reason: "nested credit should be rejected",
  });
  record(
    "6. credit-note as original rejected",
    !r.valid && r.error === "wrong_document_type",
    JSON.stringify(r),
  );
}

function scenarioCrossTenant() {
  const r = validateCreditNoteRequest({
    original: mkOriginal({ entity: ENTITY_B }),
    actingBusinessEntityId: ENTITY_A,
    creditAmount: "100.00",
    reason: "cross tenant attempt should be denied",
  });
  record(
    "7. cross-tenant rejected",
    !r.valid && r.error === "cross_tenant",
    JSON.stringify(r),
  );
}

function scenarioReasonTooShort() {
  const r = validateCreditNoteRequest({
    original: mkOriginal(),
    actingBusinessEntityId: ENTITY_A,
    creditAmount: "100.00",
    reason: "short",
  });
  record(
    "8. reason too short rejected",
    !r.valid && r.error === "reason_too_short",
    JSON.stringify(r),
  );
}

function scenarioMoneyMath() {
  const ok =
    addMoney("1234.56", "10.01") === "1244.57" &&
    subtractMoney("1000.00", "0.01") === "999.99" &&
    subtractMoney("1.00", "1.00") === "0.00" &&
    compareMoney("50.00", "50.00") === 0 &&
    compareMoney("50.01", "50.00") === 1 &&
    compareMoney("49.99", "50.00") === -1 &&
    negateMoney("100.50") === "-100.50" &&
    negateMoney("-100.50") === "100.50";
  record("9. money math — strings round-trip without float drift", ok);
}

function main() {
  console.log("[verify-credit-notes] starting…\n");
  const scenarios: Array<[string, () => void]> = [
    ["fullCredit", scenarioFullCredit],
    ["partialCredit", scenarioPartialCredit],
    ["sequentialPartials", scenarioSequentialPartials],
    ["overCredit", scenarioOverCredit],
    ["draftRejected", scenarioDraftRejected],
    ["creditNoteAsOriginal", scenarioCreditNoteAsOriginal],
    ["crossTenant", scenarioCrossTenant],
    ["reasonTooShort", scenarioReasonTooShort],
    ["moneyMath", scenarioMoneyMath],
  ];
  for (const [label, fn] of scenarios) {
    try {
      fn();
    } catch (err) {
      record(label, false, err instanceof Error ? err.message : String(err));
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n[verify-credit-notes] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
