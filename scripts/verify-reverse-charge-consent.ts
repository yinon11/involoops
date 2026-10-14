/**
 * Verification harness for reverse-charge consent
 * (`src/lib/outbound/reverse-charge-consent.ts`).
 *
 * Run: `DATABASE_URL=... npx tsx scripts/verify-reverse-charge-consent.ts`
 *
 * Needs a real database, because the guarantees under test are about what
 * lands in rows: that the raw token is never stored, that a second request
 * revokes the first, that a double submit produces one signature, that an
 * edited draft invalidates a consent — and that changing the VAT does NOT,
 * since applying the reverse charge is exactly that change.
 *
 * Writes only to its own fixtures (ids prefixed `cccc0000-`) and removes
 * them afterwards. Do not point it at production.
 */

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  businessEntities,
  customers,
  outboundInvoices,
  reverseChargeConsents,
  shaamSubmissions,
  users,
} from "@/db/schema";
import { documentAuditLog } from "@/db/schema/document-audit-log";
import {
  createConsentRequest,
  currentValidConsent,
  findConsentByToken,
  hashToken,
  latestConsentFor,
  signConsent,
} from "@/lib/outbound/reverse-charge-consent";
import {
  abandonRefusedReplacement,
  applyReverseChargeOp,
  createReverseChargeReplacementOp,
  findActiveReplacement,
  removeReverseChargeOp,
  reverseChargeIssueCheck,
  switchOnReverseChargeOp,
} from "@/lib/outbound/reverse-charge";
import { renderConsentEvidenceHtml } from "@/lib/outbound/reverse-charge-archive";
import { buildCanonicalDocument } from "@/lib/signing/canonical-document";
import { submitDocumentToShaam } from "@/lib/shaam/submit";

const P = "cccc0000-0000-0000-0000-0000000000";
const USER = `${P}ff`;
const ENTITY = `${P}fe`;
const CUST_OK = `${P}c1`;
const CUST_NO_TAX = `${P}c2`;
const CUST_NO_EMAIL = `${P}c3`;
const DOC = `${P}d1`;
const DOC_ISSUED = `${P}d2`;
const DOC_NO_TAX = `${P}d3`;
const DOC_NO_EMAIL = `${P}d4`;
const DOC_REFUSED = `${P}d5`;
const DOC_TIR_VAT = `${P}d6`;
const DOC_TIR_ZERO = `${P}d7`;
const DOC_USD = `${P}d8`;
const DOC_SWITCH = `${P}d9`;
const DOCS = [DOC, DOC_ISSUED, DOC_NO_TAX, DOC_NO_EMAIL, DOC_REFUSED, DOC_TIR_VAT, DOC_TIR_ZERO, DOC_USD, DOC_SWITCH];

// 1x1 transparent PNG — shape-valid, which is all the gate checks.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function cleanup() {
  await db
    .delete(shaamSubmissions)
    .where(eq(shaamSubmissions.businessEntityId, ENTITY));
  await db
    .delete(reverseChargeConsents)
    .where(eq(reverseChargeConsents.businessEntityId, ENTITY));
  await db
    .delete(documentAuditLog)
    .where(eq(documentAuditLog.businessEntityId, ENTITY));
  // Route B replacements first: they point at their originals.
  await db.delete(outboundInvoices).where(and(
    eq(outboundInvoices.businessEntityId, ENTITY),
    isNotNull(outboundInvoices.reverseChargeReplacesId),
  ));
  await db.delete(outboundInvoices).where(inArray(outboundInvoices.id, DOCS));
  await db
    .delete(customers)
    .where(inArray(customers.id, [CUST_OK, CUST_NO_TAX, CUST_NO_EMAIL]));
  await db.delete(businessEntities).where(eq(businessEntities.id, ENTITY));
  await db.delete(users).where(eq(users.id, USER));
}

async function seed() {
  await db.insert(users).values({ id: USER, email: "verify-rc@test.local" });
  await db.insert(businessEntities).values({
    id: ENTITY,
    ownerUserId: USER,
    legalName: "Seller Ltd",
    osekMurshe: "514000001",
    // Sandbox with no UAT grant: SHAAM requests are answered by the local
    // mock, so route B can be exercised without the Tax Authority.
    shaamSandbox: true,
  });
  await db.insert(customers).values([
    { id: CUST_OK, userId: USER, name: "Buyer Ltd", taxId: "515000008", email: "Finance@Buyer.test" },
    { id: CUST_NO_TAX, userId: USER, name: "Private Person", taxId: null, email: "p@test.local" },
    { id: CUST_NO_EMAIL, userId: USER, name: "Quiet Ltd", taxId: "516000007", email: null },
  ]);
  const base = {
    userId: USER,
    businessEntityId: ENTITY,
    invoiceDate: "2026-09-01",
    taxYear: 2026,
    subtotal: "10000.00",
    vatRate: "18",
    vatAmount: "1800.00",
    total: "11800.00",
    items: [{ description: "Consulting", quantity: 1, unitPrice: 10000, total: 10000 }],
  };
  await db.insert(outboundInvoices).values([
    { id: DOC, ...base, customerId: CUST_OK, status: "draft" as const },
    {
      id: DOC_ISSUED, ...base, customerId: CUST_OK, status: "issued" as const,
      formattedNumber: "2026-TI-000001", invoiceNumber: "1", sequenceNumber: 1,
    },
    { id: DOC_NO_TAX, ...base, customerId: CUST_NO_TAX, status: "draft" as const },
    { id: DOC_NO_EMAIL, ...base, customerId: CUST_NO_EMAIL, status: "draft" as const },
    { id: DOC_SWITCH, ...base, customerId: CUST_OK, status: "draft" as const },
    // Refused by the ITA at issue: still a draft, number already spent.
    {
      id: DOC_REFUSED, ...base, customerId: CUST_OK, status: "draft" as const,
      formattedNumber: "2026-TI-000099", invoiceNumber: "99", sequenceNumber: 99,
      shaamStatus: "REJECTED" as const, shaamActionCode: 1,
    },
  ]);
  const pay = (amount: number) => [{ method: "bank_transfer", amount, currency: "ILS", date: "2026-09-01", reference: "TX1" }];
  await db.insert(outboundInvoices).values([
    // Created with VAT: payments match 11,800, not the zero-VAT 10,000.
    { id: DOC_TIR_VAT, ...base, customerId: CUST_OK, status: "draft" as const,
      documentType: "TAX_INVOICE_RECEIPT" as const, payments: pay(11800) },
    // Created with VAT off: payments already equal the amount without VAT.
    { id: DOC_TIR_ZERO, ...base, customerId: CUST_OK, status: "draft" as const,
      documentType: "TAX_INVOICE_RECEIPT" as const, vatRate: "0", vatAmount: "0.00",
      total: "10000.00", payments: pay(10000) },
  ] as never);
  // Issued in USD at a frozen 3.7: USD 2,000 is ILS 7,400, over the threshold.
  await db.insert(outboundInvoices).values({
    id: DOC_USD, ...base, customerId: CUST_OK, status: "draft" as const,
    currency: "USD", subtotal: "2000.00", vatAmount: "360.00", total: "2360.00",
    items: [{ description: "Consulting", quantity: 1, unitPrice: 2000, total: 2000 }],
    fxRateToIls: "3.700000", fxRateSource: "boi",
    formattedNumber: "2026-TI-000098", invoiceNumber: "98", sequenceNumber: 98,
  });
  await db.insert(shaamSubmissions).values({
    documentId: DOC_REFUSED, businessEntityId: ENTITY, environment: "UAT",
    actionCode: 1, idempotencyKey: "verify-rc-refused", requestPayload: { vat_amount: 1800 },
    requestPayloadHash: "x", responseStatus: "REJECTED", responseErrorCode: "462",
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[verify-reverse-charge-consent] DATABASE_URL is not set.");
    process.exit(1);
  }
  await cleanup();
  await seed();

  try {
    // --- request guards -------------------------------------------------
    const noAck = await createConsentRequest({
      documentId: DOC, actorUserId: USER, sellerAcknowledged: false,
    });
    record("1. no seller acknowledgement → refused", !noAck.ok,
      noAck.ok ? "created!" : noAck.error.slice(0, 60));

    const noTax = await createConsentRequest({
      documentId: DOC_NO_TAX, actorUserId: USER, sellerAcknowledged: true,
    });
    record("2. buyer without 9-digit VAT number → refused", !noTax.ok,
      noTax.ok ? "created!" : noTax.error.slice(0, 60));

    // Nine digits is not enough: the check digit has to hold too.
    await db.update(customers).set({ taxId: "515000002" }).where(eq(customers.id, CUST_NO_TAX));
    const badDigit = await createConsentRequest({
      documentId: DOC_NO_TAX, actorUserId: USER, sellerAcknowledged: true,
    });
    record("2b. buyer VAT number with a wrong check digit → refused", !badDigit.ok,
      badDigit.ok ? "created!" : badDigit.error.slice(0, 60));

    const issued = await createConsentRequest({
      documentId: DOC_ISSUED, actorUserId: USER, sellerAcknowledged: true,
    });
    record("3. issued document → refused", !issued.ok,
      issued.ok ? "created!" : issued.error.slice(0, 60));

    const noEmail = await createConsentRequest({
      documentId: DOC_NO_EMAIL, actorUserId: USER, sellerAcknowledged: true,
    });
    record("4. buyer without email → refused", !noEmail.ok,
      noEmail.ok ? "created!" : noEmail.error.slice(0, 60));

    // --- happy request --------------------------------------------------
    const first = await createConsentRequest({
      documentId: DOC, actorUserId: USER, sellerAcknowledged: true,
    });
    if (!first.ok) throw new Error(`first request failed: ${first.error}`);
    const [row1] = await db.select().from(reverseChargeConsents)
      .where(eq(reverseChargeConsents.id, first.consentId));
    const rawStored = JSON.stringify(row1).includes(first.rawToken);
    record("5. request stores the token HASH, never the raw token",
      !rawStored && row1.tokenHash === hashToken(first.rawToken),
      `rawTokenInRow=${rawStored}`);
    record("5. recipient email normalised to lower case",
      first.recipientEmail === "finance@buyer.test", first.recipientEmail);

    const found = await findConsentByToken(first.rawToken);
    const unknown = await findConsentByToken("not-a-real-token");
    record("6. token resolves to pending; unknown token → null",
      found?.state === "pending" && unknown === null,
      `found=${found?.state} unknown=${unknown}`);

    // --- a second request supersedes the first -------------------------
    const second = await createConsentRequest({
      documentId: DOC, actorUserId: USER, sellerAcknowledged: true,
    });
    if (!second.ok) throw new Error(`second request failed: ${second.error}`);
    const firstAfter = await findConsentByToken(first.rawToken);
    record("7. a new request revokes the previous link",
      firstAfter?.state === "revoked", `first=${firstAfter?.state}`);

    // --- editing the draft makes the pending request stale --------------
    await db.update(outboundInvoices).set({ subtotal: "12000.00" })
      .where(eq(outboundInvoices.id, DOC));
    const stale = await findConsentByToken(second.rawToken);
    const signStale = await signConsent({
      rawToken: second.rawToken, signerName: "Dana Levi", signaturePng: PNG,
      locale: "he", ip: "203.0.113.7", userAgent: "verify",
    });
    record("8. amount edited after sending → stale, and cannot be signed",
      stale?.state === "stale" && !signStale.ok,
      `state=${stale?.state} sign=${signStale.ok}`);
    await db.update(outboundInvoices).set({ subtotal: "10000.00" })
      .where(eq(outboundInvoices.id, DOC));

    // --- signature validation ------------------------------------------
    const badSig = await signConsent({
      rawToken: second.rawToken, signerName: "Dana Levi",
      signaturePng: "data:image/png;base64,<script>", locale: "he",
      ip: "203.0.113.7", userAgent: "verify",
    });
    const noName = await signConsent({
      rawToken: second.rawToken, signerName: " ", signaturePng: PNG,
      locale: "he", ip: "203.0.113.7", userAgent: "verify",
    });
    record("9. malformed signature or blank name → refused",
      !badSig.ok && !noName.ok, `badSig=${badSig.ok} noName=${noName.ok}`);

    // --- sign ------------------------------------------------------------
    const signed = await signConsent({
      rawToken: second.rawToken, signerName: "Dana Levi", signerRole: "CFO",
      signaturePng: PNG, locale: "he", ip: "203.0.113.7", userAgent: "verify-agent",
    });
    const [row2] = await db.select().from(reverseChargeConsents)
      .where(eq(reverseChargeConsents.id, second.consentId));
    record("10. signing stores the evidence",
      signed.ok && row2.status === "signed" && row2.signerIp === "203.0.113.7" &&
        row2.signerUserAgent === "verify-agent" && row2.signerName === "Dana Levi" &&
        row2.consentLocale === "he" && (row2.consentTextHash?.length ?? 0) === 64 &&
        row2.signaturePng === PNG,
      `status=${row2.status} ip=${row2.signerIp} textHash=${row2.consentTextHash?.slice(0, 8)}`);

    const again = await signConsent({
      rawToken: second.rawToken, signerName: "Someone Else", signaturePng: PNG,
      locale: "en", ip: "198.51.100.9", userAgent: "second-tab",
    });
    const [row3] = await db.select().from(reverseChargeConsents)
      .where(eq(reverseChargeConsents.id, second.consentId));
    record("11. a second signature is refused and changes nothing",
      !again.ok && row3.signerName === "Dana Levi" && row3.signerIp === "203.0.113.7",
      `again=${again.ok} signer=${row3.signerName}`);

    // --- the gate ---------------------------------------------------------
    const valid = await currentValidConsent(DOC);
    record("12. signed consent covers the document", valid?.id === second.consentId);

    // --- route A: apply ---------------------------------------------------
    const caller = { userId: USER, businessEntityId: ENTITY };
    const noConsentApply = await applyReverseChargeOp(caller, DOC_NO_EMAIL);
    const issuedApply = await applyReverseChargeOp(caller, DOC_ISSUED);
    record("12b. apply without a signed consent, or on an issued invoice → refused",
      !noConsentApply.success && !issuedApply.success,
      `noConsent=${noConsentApply.success} issued=${issuedApply.success}`);

    // Applying the reverse charge IS a VAT change. It must not invalidate the
    // consent that authorised it.
    const applied = await applyReverseChargeOp(caller, DOC);
    const [docApplied] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, DOC));
    record("12c. apply → reverse_charge, VAT 0, total = subtotal, consent recorded",
      applied.success && docApplied.reverseCharge && docApplied.vatAmount === "0.00" &&
        docApplied.vatRate === "0.00" && docApplied.total === "10000.00" &&
        docApplied.reverseChargeConsentId === second.consentId,
      `rc=${docApplied.reverseCharge} vat=${docApplied.vatAmount} total=${docApplied.total}`);
    const afterZeroing = await currentValidConsent(DOC);
    record("13. zeroing the VAT does NOT invalidate the consent",
      afterZeroing?.id === second.consentId);
    const issueOk = await reverseChargeIssueCheck(docApplied);
    record("13b. issue check passes on the applied draft",
      issueOk.ok && issueOk.consentId === second.consentId,
      issueOk.ok ? "" : issueOk.error.slice(0, 60));

    // --- the signed record -------------------------------------------------
    const [signedRow] = await db.select().from(reverseChargeConsents)
      .where(eq(reverseChargeConsents.id, second.consentId));
    const html = renderConsentEvidenceHtml(signedRow);
    record("13c. exact signed text stored; evidence page shows text, signer, signature",
      !!signedRow.consentText && html.includes("Dana Levi") &&
        html.includes(PNG) && html.includes("203.0.113.7") &&
        html.includes(signedRow.consentText.split("\n")[0].slice(0, 20)),
      `textStored=${!!signedRow.consentText}`);

    // --- the signed canonical document --------------------------------------
    const canon = (reverseCharge: boolean) => buildCanonicalDocument({
      invoice: { ...docApplied, formattedNumber: "X", sequenceNumber: 1, reverseCharge },
      businessEntity: { id: ENTITY, legalName: "S", osekMurshe: null, entityType: "CHEVRA_BAAM", address: null },
      customer: null,
    });
    record("13d. canonical document carries reverseCharge only when true",
      canon(true).reverseCharge === true && !("reverseCharge" in canon(false)));

    await db.update(outboundInvoices)
      .set({ items: [{ description: "Consulting + extras", quantity: 1, unitPrice: 10000, total: 10000 }] })
      .where(eq(outboundInvoices.id, DOC));
    const afterEdit = await currentValidConsent(DOC);
    const sellerView = await latestConsentFor(DOC);
    const [docEdited] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, DOC));
    const issueAfterEdit = await reverseChargeIssueCheck(docEdited);
    record("14. editing a line after signing → gate refuses, seller sees 'stale', issue refused",
      afterEdit === null && sellerView?.state === "stale" && !issueAfterEdit.ok,
      `gate=${afterEdit ? "valid" : "null"} seller=${sellerView?.state} issue=${issueAfterEdit.ok}`);

    // VAT put back on a reverse-charge draft (e.g. by editing it) must block issue.
    await db.update(outboundInvoices).set({ vatAmount: "1800.00" })
      .where(eq(outboundInvoices.id, DOC));
    const [docWithVat] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, DOC));
    const issueWithVat = await reverseChargeIssueCheck(docWithVat);
    record("14b. reverse-charge draft with VAT on it → issue refused",
      !issueWithVat.ok, issueWithVat.ok ? "allowed!" : issueWithVat.error.slice(0, 60));

    const removed = await removeReverseChargeOp(caller, DOC);
    const [docRemoved] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, DOC));
    record("14c. remove → statutory VAT restored, flag and consent cleared",
      removed.success && !docRemoved.reverseCharge && docRemoved.reverseChargeConsentId === null &&
        docRemoved.vatRate === "18.00" && docRemoved.vatAmount === "1800.00" &&
        docRemoved.total === "11800.00",
      `vat=${docRemoved.vatRate}/${docRemoved.vatAmount} total=${docRemoved.total}`);

    // --- route B: reverse charge after an ITA refusal ----------------------
    // The refused invoice is not re-sent; a NEW zero-VAT invoice replaces
    // it, with its own number, and asks under the refused invoice's id.
    let threw = false;
    try {
      await submitDocumentToShaam({ documentId: DOC_REFUSED, actorUserId: USER, actionCode: 3 });
    } catch { threw = true; }
    record("17. action 3 on the refused invoice itself → refused before sending", threw);

    const tooEarly = await createReverseChargeReplacementOp(caller, DOC_REFUSED);
    record("17b. no replacement before reverse charge is applied to the refused invoice",
      !tooEarly.success, tooEarly.success ? "created!" : tooEarly.error.slice(0, 60));

    const reqB = await createConsentRequest({
      documentId: DOC_REFUSED, actorUserId: USER, sellerAcknowledged: true,
    });
    if (!reqB.ok) throw new Error(`route B request failed: ${reqB.error}`);
    await signConsent({
      rawToken: reqB.rawToken, signerName: "Dana Levi", signaturePng: PNG,
      locale: "he", ip: "203.0.113.7", userAgent: "verify",
    });
    const appliedB = await applyReverseChargeOp(caller, DOC_REFUSED);
    if (!appliedB.success) throw new Error(`route B apply failed: ${appliedB.error}`);

    const firstRepl = await createReverseChargeReplacementOp(caller, DOC_REFUSED);
    if (!firstRepl.success) throw new Error(`replacement failed: ${firstRepl.error}`);
    const replAgain = await createReverseChargeReplacementOp(caller, DOC_REFUSED);
    const [repl1] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, firstRepl.replacementId));
    const [origAfterChoice] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, DOC_REFUSED));
    record("18. replacement is a new zero-VAT draft with no number, linked to the original; idempotent",
      repl1.id !== DOC_REFUSED && repl1.status === "draft" && repl1.formattedNumber === null &&
        repl1.reverseCharge && repl1.reverseChargeReplacesId === DOC_REFUSED &&
        repl1.vatAmount === "0.00" && repl1.total === "10000.00" && repl1.subtotal === "10000.00" &&
        replAgain.success && replAgain.replacementId === repl1.id &&
        origAfterChoice.status === "draft" && !!origAfterChoice.shaamRejectionChoiceAt,
      `number=${repl1.formattedNumber} vat=${repl1.vatAmount} total=${repl1.total} same=${replAgain.success && replAgain.replacementId === repl1.id}`);

    const replCheck = await reverseChargeIssueCheck(repl1);
    record("18b. the original's consent covers the replacement at issue",
      replCheck.ok && replCheck.consentId === reqB.consentId,
      replCheck.ok ? "" : replCheck.error.slice(0, 60));

    await db.update(outboundInvoices)
      .set({ items: [{ description: "Something else", quantity: 1, unitPrice: 10000, total: 10000 }] })
      .where(eq(outboundInvoices.id, repl1.id));
    const [repl1Edited] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, repl1.id));
    const editedCheck = await reverseChargeIssueCheck(repl1Edited);
    record("18c. editing the replacement after the buyer signed → issue refused", !editedCheck.ok);

    const removedB = await removeReverseChargeOp(caller, DOC_REFUSED);
    const [repl1Gone] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, repl1.id));
    const reapplied = await applyReverseChargeOp(caller, DOC_REFUSED);
    const secondRepl = await createReverseChargeReplacementOp(caller, DOC_REFUSED);
    record("18d. removing reverse charge on the original discards an unnumbered replacement; a new one can follow",
      removedB.success && !!repl1Gone.deletedAt && reapplied.success &&
        secondRepl.success && secondRepl.replacementId !== repl1.id,
      `removed=${removedB.success} deleted=${!!repl1Gone.deletedAt} again=${secondRepl.success}`);
    if (!secondRepl.success) throw new Error("second replacement failed");
    const REPL = secondRepl.replacementId;

    // Issuing allocates the replacement its own number before asking.
    await db.update(outboundInvoices)
      .set({ formattedNumber: "2026-TI-000100", invoiceNumber: "100", sequenceNumber: 100 })
      .where(eq(outboundInvoices.id, REPL));
    const blockedRemove = await removeReverseChargeOp(caller, DOC_REFUSED);
    record("18e. once the replacement holds a number, reverse charge on the original cannot be removed",
      !blockedRemove.success, blockedRemove.success ? "removed!" : blockedRemove.error.slice(0, 60));

    const resB = await submitDocumentToShaam({
      documentId: REPL, actorUserId: USER, actionCode: 3,
    });
    const [replB] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, REPL));
    record("19. the replacement's zero-VAT action 3 is SENT (not skipped as 'zero VAT') and approved",
      resB.shaamStatus === "APPROVED" && !resB.skipped &&
        !!resB.allocationNumber && replB.allocationNumber === resB.allocationNumber &&
        replB.shaamActionCode === 3,
      `status=${resB.shaamStatus} skipped=${resB.skipped} alloc=${resB.allocationNumber}`);

    const [origB] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, DOC_REFUSED));
    const stornoRows = await db.select({ p: documentAuditLog.eventPayload })
      .from(documentAuditLog)
      .where(and(eq(documentAuditLog.documentId, DOC_REFUSED),
        eq(documentAuditLog.eventType, "SHAAM_REJECTION_RESOLVED")));
    const storno = stornoRows.map((r) => r.p as Record<string, unknown>)
      .find((p) => p.phase === "storno");
    const [refusedSub] = await db.select({ id: shaamSubmissions.id }).from(shaamSubmissions)
      .where(eq(shaamSubmissions.idempotencyKey, "verify-rc-refused"));
    record("19b. approval cancels (storno) the refused ORIGINAL, keeping its number, naming the replacement",
      origB.status === "voided" && origB.shaamStatus === "CANCELLED_AFTER_REJECTION" &&
        origB.shaamRejectionChoice === "reverse_charge" && origB.formattedNumber === "2026-TI-000099" &&
        !!storno && storno.choice === "reverse_charge" &&
        storno.specialAllocationNumber === resB.allocationNumber &&
        storno.replacementId === REPL &&
        storno.stornoOfSubmissionId === refusedSub.id && storno.stornoOfVatAmount === 1800 &&
        replB.status === "draft",
      `orig=${origB.status}/${origB.shaamStatus}/${origB.shaamRejectionChoice} storno=${JSON.stringify(storno ?? null).slice(0, 80)}`);
    const active = await findActiveReplacement(DOC_REFUSED);
    record("19c. the original links to its replacement", active?.id === REPL);

    // The ITA refuses the reverse charge itself: the numbered replacement
    // is voided with the reason; nothing is issued.
    const [abandon] = await db.insert(outboundInvoices).values({
      userId: USER, businessEntityId: ENTITY, customerId: CUST_OK, invoiceDate: "2026-09-01",
      taxYear: 2026, subtotal: "10000.00", vatRate: "0.00", vatAmount: "0.00", total: "10000.00",
      items: [{ description: "Consulting", quantity: 1, unitPrice: 10000, total: 10000 }],
      status: "draft", reverseCharge: true, reverseChargeReplacesId: DOC_REFUSED,
      formattedNumber: "2026-TI-000101", invoiceNumber: "101", sequenceNumber: 101,
      shaamStatus: "REJECTED", shaamActionCode: 3,
    }).returning({ id: outboundInvoices.id });
    await abandonRefusedReplacement({ replacementId: abandon.id, actorUserId: USER });
    const [abandoned] = await db.select().from(outboundInvoices)
      .where(eq(outboundInvoices.id, abandon.id));
    const abandonAudit = await db.select({ p: documentAuditLog.eventPayload })
      .from(documentAuditLog)
      .where(and(eq(documentAuditLog.documentId, abandon.id),
        eq(documentAuditLog.eventType, "SHAAM_REJECTION_RESOLVED")));
    const abandonPayload = abandonAudit[0]?.p as Record<string, unknown> | undefined;
    record("19d. a replacement the ITA refused is voided with its number explained",
      abandoned.status === "voided" && abandoned.shaamStatus === "CANCELLED_AFTER_REJECTION" &&
        abandonPayload?.reason === "reverse_charge_refused" &&
        abandonPayload?.burntFormattedNumber === "2026-TI-000101",
      `status=${abandoned.status}/${abandoned.shaamStatus} reason=${abandonPayload?.reason}`);

    // --- tax invoice-receipt: payments must equal the zero-VAT total -------
    // Requesting consent converts the draft, so a mismatch is refused at the
    // request, before any link goes out.
    const tirVat = await createConsentRequest({
      documentId: DOC_TIR_VAT, actorUserId: USER, sellerAcknowledged: true,
    });
    const [tirVatRow] = await db.select().from(outboundInvoices).where(eq(outboundInvoices.id, DOC_TIR_VAT));
    const tirZeroReq = await createConsentRequest({
      documentId: DOC_TIR_ZERO, actorUserId: USER, sellerAcknowledged: true,
    });
    if (!tirZeroReq.ok) throw new Error(`TIR request failed: ${tirZeroReq.error}`);
    await signConsent({ rawToken: tirZeroReq.rawToken, signerName: "Dana Levi", signaturePng: PNG,
      locale: "he", ip: "203.0.113.7", userAgent: "verify" });
    const [tirRow] = await db.select().from(outboundInvoices).where(eq(outboundInvoices.id, DOC_TIR_ZERO));
    const tirIssue = await reverseChargeIssueCheck(tirRow);
    record("20. invoice-receipt: request refused when payments include VAT (draft untouched); converted and issuable when they equal the amount without VAT",
      !tirVat.ok && !tirVatRow.reverseCharge && tirVatRow.vatAmount === "1800.00" &&
        tirRow.reverseCharge && tirIssue.ok,
      `withVat=${tirVat.ok ? "requested!" : tirVat.error.slice(0, 50)} zero=${tirRow.reverseCharge} issue=${tirIssue.ok}`);
    const tirRemoved = await removeReverseChargeOp(caller, DOC_TIR_ZERO);
    const [tirAfter] = await db.select().from(outboundInvoices).where(eq(outboundInvoices.id, DOC_TIR_ZERO));
    record("21. removing reverse charge from an invoice-receipt keeps its amounts (payments stay valid)",
      tirRemoved.success && !tirAfter.reverseCharge && tirAfter.vatAmount === "0.00" && tirAfter.total === "10000.00",
      `vat=${tirAfter.vatAmount} total=${tirAfter.total}`);

    // --- foreign currency: tested in ILS, no longer skipped ----------------
    const usdRes = await submitDocumentToShaam({ documentId: DOC_USD, actorUserId: USER, actionCode: 1 });
    record("22. USD invoice over the ILS threshold is sent for allocation, not skipped as foreign_currency",
      usdRes.shaamStatus === "APPROVED" && !usdRes.skipped,
      `status=${usdRes.shaamStatus} skipped=${usdRes.skipped} reason=${usdRes.skippedReason ?? ""}`);

    // --- the reverse-charge switch on the invoice page ----------------------
    const rowOf = async (id: string) =>
      (await db.select().from(outboundInvoices).where(eq(outboundInvoices.id, id)))[0];
    const on = await switchOnReverseChargeOp(caller, DOC_SWITCH);
    const swOn = await rowOf(DOC_SWITCH);
    const swOnCheck = await reverseChargeIssueCheck(swOn);
    const [swAudit] = await db.select({ p: documentAuditLog.eventPayload }).from(documentAuditLog)
      .where(and(eq(documentAuditLog.documentId, DOC_SWITCH), eq(documentAuditLog.eventType, "REVERSE_CHARGE_APPLIED")));
    record("23. switch on: VAT → 0 before any signature, logged; issuing stays refused until the buyer signs",
      on.success && swOn.reverseCharge && swOn.vatAmount === "0.00" && swOn.total === "10000.00" &&
        swOn.reverseChargeConsentId === null && !swOnCheck.ok && !swOnCheck.pendingSignature &&
        (swAudit?.p as Record<string, unknown> | undefined)?.reason === "switch_on",
      `vat=${swOn.vatAmount} issue=${swOnCheck.ok}`);

    const offNoTax = await switchOnReverseChargeOp(caller, DOC_NO_TAX);
    const offTir = await switchOnReverseChargeOp(caller, DOC_TIR_VAT);
    const offIssued = await switchOnReverseChargeOp(caller, DOC_ISSUED);
    const [noTaxRow, tirVatAfter] = [await rowOf(DOC_NO_TAX), await rowOf(DOC_TIR_VAT)];
    record("23b. switch on refused for a buyer without a VAT number, an invoice-receipt paid with VAT, an issued invoice — all untouched",
      !offNoTax.success && !offTir.success && !offIssued.success &&
        !noTaxRow.reverseCharge && noTaxRow.vatAmount === "1800.00" &&
        !tirVatAfter.reverseCharge && tirVatAfter.vatAmount === "1800.00");

    const swReq1 = await createConsentRequest({ documentId: DOC_SWITCH, actorUserId: USER, sellerAcknowledged: true });
    if (!swReq1.ok) throw new Error(`switch request failed: ${swReq1.error}`);
    const off = await removeReverseChargeOp(caller, DOC_SWITCH);
    const swOff = await rowOf(DOC_SWITCH);
    const [req1After] = await db.select().from(reverseChargeConsents).where(eq(reverseChargeConsents.id, swReq1.consentId));
    record("23c. switch off: VAT restored and the open signing link cancelled",
      off.success && !swOff.reverseCharge && swOff.vatAmount === "1800.00" && swOff.total === "11800.00" &&
        req1After.status === "revoked",
      `vat=${swOff.vatAmount} link=${req1After.status}`);

    await switchOnReverseChargeOp(caller, DOC_SWITCH);
    const swReq2 = await createConsentRequest({ documentId: DOC_SWITCH, actorUserId: USER, sellerAcknowledged: true });
    if (!swReq2.ok) throw new Error(`switch request failed: ${swReq2.error}`);
    const pendingCheck = await reverseChargeIssueCheck(await rowOf(DOC_SWITCH));
    await signConsent({ rawToken: swReq2.rawToken, signerName: "Dana Levi", signaturePng: PNG,
      locale: "he", ip: "203.0.113.7", userAgent: "verify" });
    const signedCheck = await reverseChargeIssueCheck(await rowOf(DOC_SWITCH));
    record("23d. step 1 then step 2: waiting for the signature, then issuable once signed",
      !pendingCheck.ok && pendingCheck.pendingSignature === true && signedCheck.ok,
      `pending=${pendingCheck.ok} signed=${signedCheck.ok}`);

    // VAT put back by an edit: switching on again repairs it on the same signature.
    await db.update(outboundInvoices).set({ vatRate: "18", vatAmount: "1800.00", total: "11800.00" })
      .where(eq(outboundInvoices.id, DOC_SWITCH));
    const editedVat = await reverseChargeIssueCheck(await rowOf(DOC_SWITCH));
    const repaired = await switchOnReverseChargeOp(caller, DOC_SWITCH);
    const swRepaired = await rowOf(DOC_SWITCH);
    const repairedCheck = await reverseChargeIssueCheck(swRepaired);
    record("23e. VAT put back by an edit → issue refused; switching on again zeroes it and keeps the signature",
      !editedVat.ok && repaired.success && swRepaired.vatAmount === "0.00" &&
        swRepaired.reverseChargeConsentId === swReq2.consentId && repairedCheck.ok,
      `vat=${swRepaired.vatAmount} issue=${repairedCheck.ok}`);

    // --- expiry is derived, not stored ------------------------------------
    const third = await createConsentRequest({
      documentId: DOC, actorUserId: USER, sellerAcknowledged: true,
    });
    if (!third.ok) throw new Error(`third request failed: ${third.error}`);
    await db.update(reverseChargeConsents)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(reverseChargeConsents.id, third.consentId));
    const expired = await findConsentByToken(third.rawToken);
    record("15. past expires_at → expired (column still says pending)",
      expired?.state === "expired" && expired.consent.status === "pending",
      `state=${expired?.state} column=${expired?.consent.status}`);

    // --- tamper-evident trail ----------------------------------------------
    const events = await db.select({ t: documentAuditLog.eventType, p: documentAuditLog.eventPayload })
      .from(documentAuditLog)
      .where(and(eq(documentAuditLog.businessEntityId, ENTITY),
        eq(documentAuditLog.documentId, DOC)));
    const kinds = events.map((e) => e.t);
    // A request converts the draft (one APPLIED, reason on_consent_request)
    // unless it already is reverse charge: the first request and the one
    // after removal convert it; the re-request does not; the explicit apply
    // in 12c is the third.
    const appliedOnRequest = events.filter((e) =>
      e.t === "REVERSE_CHARGE_APPLIED" &&
      (e.p as Record<string, unknown>).reason === "on_consent_request").length;
    record("16. requests, signature, apply and remove are in the hash-chained audit log",
      kinds.filter((k) => k === "REVERSE_CHARGE_CONSENT_REQUESTED").length === 3 &&
        kinds.filter((k) => k === "REVERSE_CHARGE_CONSENT_SIGNED").length === 1 &&
        kinds.filter((k) => k === "REVERSE_CHARGE_APPLIED").length === 3 &&
        appliedOnRequest === 2 &&
        kinds.filter((k) => k === "REVERSE_CHARGE_REMOVED").length === 1,
      kinds.join(","));
  } finally {
    await cleanup();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[verify-reverse-charge-consent] ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

void main();
