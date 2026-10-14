import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  businessEntities,
  customers,
  outboundInvoices,
  shaamSubmissions,
  users,
} from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { getActiveAccessToken } from "./authorization";
import {
  getShaamConfig,
  getShaamUatClearanceUrl,
  submitInvoice,
  type ShaamSubmitResult,
} from "./client";
import { hasActiveAuthorization } from "./authorization";
import {
  getSandboxMockOutcome,
  mockShaamResult,
  type SandboxMockOutcome,
} from "./sandbox-mock-outcome";
import {
  sandboxMockAllocationNumber,
} from "./sandbox";
import {
  isShaamTenantSubmitSerializeEnabled,
  withShaamTenantSubmitLock,
} from "./tenant-submit-lock";
import { ShaamAuthorizationError } from "./errors";
import {
  buildShaamPayload,
  computeIdempotencyKey,
  computePayloadHash,
  type ShaamActionCode,
} from "./payload";
import { requiresAllocation } from "./thresholds";
import { compareMoney } from "@/lib/money";
import {
  allocationAmountsIls,
  ilsPayloadAmounts,
} from "@/lib/shaam/allocation-amounts";

/**
 * Resolve the 9-digit `accounting_software_number` for SHAAM v2
 * (Table 2.1 item 15).
 *
 * Order of precedence:
 *   1. `SHAAM_ACCOUNTING_SOFTWARE_NUMBER` — the official ITA-issued
 *      number once Form 513 is approved.
 *   2. `SOFTWARE_HOUSE_VAT_NUMBER` — the spec explicitly allows
 *      falling back to the document producer's company VAT when no
 *      software registration certificate is yet available.
 *
 * Throws when neither is set, since the field is mandatory and the
 * caller has no sensible default.
 */
function resolveAccountingSoftwareNumber(): string {
  const issued = process.env.SHAAM_ACCOUNTING_SOFTWARE_NUMBER?.trim();
  if (issued) return issued;
  const houseVat = process.env.SOFTWARE_HOUSE_VAT_NUMBER?.trim();
  if (houseVat) return houseVat;
  throw new Error(
    "SHAAM clearance: accounting_software_number is required but neither SHAAM_ACCOUNTING_SOFTWARE_NUMBER nor SOFTWARE_HOUSE_VAT_NUMBER is set.",
  );
}

export type SubmitTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ShaamStatus =
  | "NOT_APPLICABLE"
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "HELD"
  | "OUTAGE_ISSUED";

export interface SubmitResultShape {
  shaamStatus: ShaamStatus;
  allocationNumber: string | null;
  submissionId: string | null;
  skipped: boolean;
  skippedReason?: string;
  /**
   * A voluntary request was answered with a refusal or a hold. The row
   * is stored as NOT_REQUIRED so it never looks like a statutory refusal.
   * The caller still has to ask the seller before issuing.
   */
  voluntaryDeclined?: boolean;
}

const MAX_SUBMISSION_AGE_MS_BEFORE_RETRY = 60_000;

/**
 * Spec 08 entry point. Idempotent: reruns for the same document +
 * version bounce off the `shaam_submissions.idempotency_key`
 * constraint. Safe to call from both the issuance flow (once,
 * inline) and the retry cron (repeatedly, backed off).
 *
 * When `SHAAM_TENANT_SUBMIT_SERIALIZE=1`, the clearance pipeline (token
 * fetch through ITA POST + `recordResult`) runs under a Postgres
 * **session** advisory lock keyed per `business_entity_id` so the same
 * tenant cannot blast ITA with parallel clearance requests across
 * invoices. A lock miss returns `skippedReason: tenant_shaam_serialize_busy`
 * (see `withShaamTenantSubmitLock`). Otherwise, concurrent retries for
 * the same document still collapse via the idempotency row + a
 * short `concurrent_in_flight` window when a submission row exists
 * with no response yet.
 */
export async function submitDocumentToShaam(params: {
  documentId: string;
  actorUserId: string;
  actionCode?: ShaamActionCode;
  /**
   * The seller explicitly asked for a number the rules do not require.
   * Spec §1.2: "an allocation number for each invoice may be requested, for
   * any amount and for each customer including credits."
   *
   * Two effects, deliberately inseparable — one flag so neither can be set
   * without the other:
   *
   *   1. the threshold short-circuit is bypassed, and
   *   2. **a non-approval is never written as a refusal.** The document is
   *      already issued and legal without a number, so REJECTED would render
   *      as "the Tax Authority refused this invoice" and hand the seller the
   *      four statutory remedies for a problem they do not have — one of
   *      which burns the fiscal number.
   *
   * (2) lives here rather than in the caller because `recordResult` commits
   * its own transaction: restoring the status afterwards left a committed
   * window holding REJECTED, and a process death inside it stranded the
   * invoice in the very dialog this exists to avoid — with no way back,
   * since the voluntary path is gated to NOT_REQUIRED.
   *
   * Never set by the issue path or the cron.
   */
  voluntary?: boolean;
}): Promise<SubmitResultShape> {
  const actionCode: ShaamActionCode = params.actionCode ?? 1;
  const cfg = getShaamConfig();

  const [invoice] = await db
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, params.documentId))
    .limit(1);
  if (!invoice) throw new Error(`Invoice not found: ${params.documentId}`);
  // SHAAM allocations are keyed off the seller's invoice number, so we
  // refuse to submit a draft that hasn't been numbered yet. The issue
  // flow (`issueOutboundInvoiceOp`) allocates before calling here.
  if (invoice.formattedNumber == null) {
    throw new Error(
      `Cannot submit invoice ${params.documentId} to SHAAM — no fiscal ` +
        "number has been allocated. Call issueOutboundInvoiceOp first.",
    );
  }
  const invoiceFormattedNumber = invoice.formattedNumber;

  const [entity] = await db
    .select()
    .from(businessEntities)
    .where(eq(businessEntities.id, invoice.businessEntityId))
    .limit(1);
  if (!entity) throw new Error(`Business entity not found for invoice`);

  // Non-fiscal documents (proforma = הצעת מחיר/חשבון עסקה,
  // delivery note = תעודת משלוח) never go through SHAAM — they are
  // pre-issuance / shipping records, not VAT invoices. Short-circuit
  // to NOT_APPLICABLE with a clean audit entry so the issue path
  // continues without hitting the gov.il endpoint.
  if (
    invoice.documentType === "PROFORMA" ||
    invoice.documentType === "DELIVERY_NOTE"
  ) {
    await db.transaction(async (tx) => {
      await tx
        .update(outboundInvoices)
        .set({
          shaamStatus: "NOT_APPLICABLE",
          shaamActionCode: actionCode,
          // Deliberately NOT stamping shaamSubmittedAt / shaamResponseAt:
          // this path returns before any HTTP call, so nothing was
          // submitted and nothing responded. Stamping them made the API
          // (`shaam_submitted_at`) report a filing that never happened.
          // The skip is recorded in the audit entry below; `updatedAt`
          // carries when it was evaluated.
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(outboundInvoices.id, invoice.id));
      await appendAuditEntry({
        tx,
        businessEntityId: invoice.businessEntityId,
        userId: invoice.userId,
        documentId: invoice.id,
        documentType: invoice.documentType,
        eventType: "SHAAM_SUBMITTED",
        eventPayload: {
          skipped: true,
          reason: "non_fiscal_document_type",
          documentType: invoice.documentType,
          actionCode,
        },
        actor: { userId: params.actorUserId },
      });
    });
    return {
      shaamStatus: "NOT_APPLICABLE",
      allocationNumber: null,
      submissionId: null,
      skipped: true,
      skippedReason: "non_fiscal_document_type",
    };
  }

  const customer = invoice.customerId
    ? (
        await db
          .select()
          .from(customers)
          .where(eq(customers.id, invoice.customerId))
          .limit(1)
      )[0] ?? null
    : null;

  // 1) Threshold check — below-threshold / foreign-currency / no
  // customer osek_murshe short-circuits to NOT_REQUIRED with a clear
  // audit entry and no HTTP call.
  // In ILS whatever the document currency, at the rate frozen on it at
  // issue: the obligation is tested on the ILS value, and the ITA has no
  // currency field — everything it receives is ILS.
  const obligation = allocationAmountsIls(invoice);
  const check = requiresAllocation({
    issueDate: new Date(
      `${invoice.printedDate ?? invoice.invoiceDate}T00:00:00Z`,
    ),
    preVatAmount: obligation.preVatAmount,
    currency: obligation.currency,
    customerIsOsekMurshe: Boolean(
      customer?.taxId && /^\d{9}$/.test(customer.taxId),
    ),
    vatAmount: obligation.vatAmount,
  });
  // Action 3 — reverse charge after a refusal (spec §2.2.2) — is sent at
  // zero VAT by definition, which the threshold check reads as "nothing
  // owed". It is not a request for a number the law requires; it resolves
  // an invoice the ITA already holds as refused, and it is the only way to
  // obtain the special allocation number. So it is always sent.
  if (actionCode === 3 && compareMoney(String(invoice.vatAmount ?? "0"), "0") !== 0) {
    throw new Error(
      `Reverse charge (action 3) must be sent with zero VAT; document ${invoice.id} has ${invoice.vatAmount}.`,
    );
  }
  // ...and by a new invoice that replaces the refused one: the request
  // goes under the refused invoice's Invoice_Id.
  let replacesFormattedNumber: string | null = null;
  if (actionCode === 3) {
    const [refused] = invoice.reverseChargeReplacesId
      ? await db
          .select({ formattedNumber: outboundInvoices.formattedNumber })
          .from(outboundInvoices)
          .where(eq(outboundInvoices.id, invoice.reverseChargeReplacesId))
          .limit(1)
      : [];
    if (!refused?.formattedNumber) {
      throw new Error(
        `Reverse charge (action 3) is sent by the invoice that replaces a refused one; document ${invoice.id} replaces none.`,
      );
    }
    replacesFormattedNumber = refused.formattedNumber;
  }
  if (!check.required && !params.voluntary && actionCode !== 3) {
    await db.transaction(async (tx) => {
      await tx
        .update(outboundInvoices)
        .set({
          shaamStatus: "NOT_REQUIRED",
          shaamActionCode: actionCode,
          // The reason used to exist only inside the audit payload, so the
          // seller saw a bare "not required" whatever the cause — including
          // when the truth was "we could not ask, the customer has no tax id
          // on file". Stored here because it is the one field the status
          // panel already receives; it holds a skip reason, not an ITA error
          // code, and `explainShaamError` has no entry for these so nothing
          // mistakes it for one.
          shaamLastErrorCode: check.reason,
          shaamLastErrorMessage: null,
          // Same as the non-fiscal path above: no HTTP call is reachable
          // past this branch, so the submitted / response timestamps stay
          // null rather than claiming a submission that never occurred.
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(outboundInvoices.id, invoice.id));
      await appendAuditEntry({
        tx,
        businessEntityId: invoice.businessEntityId,
        userId: invoice.userId,
        documentId: invoice.id,
        documentType: invoice.documentType,
        eventType: "SHAAM_SUBMITTED",
        eventPayload: {
          skipped: true,
          reason: check.reason,
          actionCode,
        },
        actor: { userId: params.actorUserId },
      });
    });
    return {
      shaamStatus: "NOT_REQUIRED",
      allocationNumber: null,
      submissionId: null,
      skipped: true,
      skippedReason: check.reason,
    };
  }

  // Sandbox entities never hit the production clearance API. An active
  // UAT grant is posted only to the test path. With no grant, approval
  // is mocked locally and no HTTP request is made.
  let shaamEnvironment = cfg.environment;
  let clearanceUrl: string | undefined;
  // Sandbox testing: a forced refusal, hold or outage set in the admin
  // panel, instead of asking the ITA test service (`sandbox-mock-outcome.ts`).
  let forcedOutcome: Exclude<SandboxMockOutcome, { kind: "approve" }> | null = null;
  if (
    entity.shaamSandbox &&
    invoice.shaamStatus === "APPROVED" &&
    invoice.allocationNumber?.startsWith("TEST-")
  ) {
    return {
      shaamStatus: "APPROVED",
      allocationNumber: invoice.allocationNumber,
      submissionId: null,
      skipped: true,
      skippedReason: "sandbox_mock_replay",
    };
  }
  // Applies to every business on the sandbox stack — everything there is
  // test data — and is null anywhere else (`getSandboxMockOutcome`).
  const forced = await getSandboxMockOutcome();
  if (forced?.kind === "approve") {
    return approveSandboxMock({
      invoice,
      actorUserId: params.actorUserId,
      actionCode,
    });
  }
  if (forced) {
    forcedOutcome = forced;
    shaamEnvironment = "UAT";
  } else if (entity.shaamSandbox) {
    const uatReady = await hasActiveAuthorization(
      invoice.businessEntityId,
      "UAT",
    );
    if (!uatReady) {
      return approveSandboxMock({
        invoice,
        actorUserId: params.actorUserId,
        actionCode,
      });
    }
    shaamEnvironment = "UAT";
    clearanceUrl = getShaamUatClearanceUrl();
  }

  // 2) Idempotency key + already-submitted short-circuit.
  const idempotencyKey = computeIdempotencyKey({
    businessEntityId: invoice.businessEntityId,
    documentId: invoice.id,
    actionCode,
    version: invoice.version,
  });
  const existingRows = await db
    .select()
    .from(shaamSubmissions)
    .where(
      and(
        eq(shaamSubmissions.idempotencyKey, idempotencyKey),
        eq(shaamSubmissions.environment, shaamEnvironment),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (existing) {
    if (existing.responseStatus === "APPROVED" && existing.responseAllocationNumber) {
      // Replay: ensure the document carries the cached allocation.
      await db
        .update(outboundInvoices)
        .set({
          shaamStatus: "APPROVED",
          allocationNumber: existing.responseAllocationNumber,
          shaamResponseAt: existing.respondedAt ?? new Date(),
          shaamRequestId: existing.requestId ?? null,
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(outboundInvoices.id, invoice.id));
      return {
        shaamStatus: "APPROVED",
        allocationNumber: existing.responseAllocationNumber,
        submissionId: existing.id,
        skipped: true,
        skippedReason: "idempotency_replay",
      };
    }
    if (existing.responseStatus === null) {
      // Dangling row — prior attempt died before recording a response.
      const age = Date.now() - existing.submittedAt.getTime();
      if (age < MAX_SUBMISSION_AGE_MS_BEFORE_RETRY) {
        // Another concurrent clearance attempt for this idempotency key
        // is still in flight (no response row yet).
        //
        // Count it. Neither this path nor the tenant-lock one below used
        // to touch `shaamRetryCount`, which left the document on rung 0
        // of the ladder (30s, under the cron's floor) and therefore due
        // on every single run, for ever. A document that cannot get past
        // a lock for nine hours is a wedge worth surfacing, not something
        // to retry silently until someone notices. The increment is a
        // bare SQL `+ 1`, so it cannot lose against the attempt that is
        // actually in flight.
        await db
          .update(outboundInvoices)
          .set({
            shaamRetryCount: sql`${outboundInvoices.shaamRetryCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(outboundInvoices.id, invoice.id));
        return {
          shaamStatus: "PENDING",
          allocationNumber: null,
          submissionId: existing.id,
          skipped: true,
          skippedReason: "concurrent_in_flight",
        };
      }
      // Older than a minute — treat as dead and reuse the row below.
    }
  }

  const runShaamClearancePipeline = async (): Promise<SubmitResultShape> => {
    // 3) Access token. Typed ShaamAuthorizationError on expiry. A forced
    // sandbox answer needs none — nothing is sent.
    let accessToken = "";
    if (!forcedOutcome) try {
      accessToken = await getActiveAccessToken({
        businessEntityId: invoice.businessEntityId,
        environment: shaamEnvironment,
      });
    } catch (err) {
      const reason =
        err instanceof ShaamAuthorizationError ? err.reason : "error";
      // A voluntary ask is not an obligation. Failing to reach the Tax
      // Authority must not park the document in the retry queue: it never
      // needed a number, so issue continues without one.
      if (params.voluntary) {
        await db.transaction(async (tx) => {
          await tx
            .update(outboundInvoices)
            .set({
              shaamStatus: "NOT_REQUIRED",
              shaamActionCode: actionCode,
              shaamLastErrorCode: "auth_" + reason,
              shaamLastErrorMessage:
                err instanceof Error ? err.message : String(err),
              version: sql`${outboundInvoices.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(outboundInvoices.id, invoice.id));
          await appendAuditEntry({
            tx,
            businessEntityId: invoice.businessEntityId,
            userId: invoice.userId,
            documentId: invoice.id,
            documentType: invoice.documentType,
            eventType: "SHAAM_SUBMITTED",
            eventPayload: {
              skipped: true,
              reason: "authorization_" + reason,
              voluntary: true,
              actionCode,
            },
            actor: { userId: params.actorUserId },
          });
        });
        return {
          shaamStatus: "NOT_REQUIRED",
          allocationNumber: null,
          submissionId: null,
          skipped: true,
          skippedReason: "authorization_" + reason,
        };
      }
      await db.transaction(async (tx) => {
        await tx
          .update(outboundInvoices)
          .set({
            shaamStatus: "PENDING",
            shaamActionCode: actionCode,
            shaamSubmittedAt: new Date(),
            shaamLastErrorCode: "auth_" + reason,
            shaamLastErrorMessage:
              err instanceof Error ? err.message : String(err),
            shaamRetryCount: sql`${outboundInvoices.shaamRetryCount} + 1`,
            version: sql`${outboundInvoices.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(outboundInvoices.id, invoice.id));
        await appendAuditEntry({
          tx,
          businessEntityId: invoice.businessEntityId,
          userId: invoice.userId,
          documentId: invoice.id,
          documentType: invoice.documentType,
          eventType: "SHAAM_REJECTED",
          eventPayload: {
            reason: "authorization_" + reason,
            actionCode,
          },
          actor: { userId: params.actorUserId },
        });
      });
      return {
        shaamStatus: "PENDING",
        allocationNumber: null,
        submissionId: null,
        skipped: false,
      };
    }

    // 4) Build payload. Resolve the actor (for `user_name` / `user_id`)
    // and the software-registration number (Table 2.1 item 15) before
    // calling the builder — both are required by v2.
    const [actorRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, params.actorUserId))
      .limit(1);
    const accountingSoftwareNumber = resolveAccountingSoftwareNumber();
    const ilsMoney = ilsPayloadAmounts(invoice);
    const payload = buildShaamPayload({
      invoice: {
        id: invoice.id,
        formattedNumber: invoiceFormattedNumber,
        documentType: invoice.documentType,
        invoiceDate: invoice.printedDate ?? invoice.invoiceDate,
        items: ilsMoney.items,
        subtotal: ilsMoney.subtotal,
        vatRate: invoice.vatRate,
        vatAmount: ilsMoney.vatAmount,
        total: ilsMoney.total,
        currency: ilsMoney.currency,
        notes: invoice.notes,
        replacesFormattedNumber,
      },
      businessEntity: { osekMurshe: entity.osekMurshe },
      // 1:1 user↔business today: the operator's tax-id is the same N9
      // as the issuer. When the multi-user-per-business rollout lands
      // we'll source `taxId` from a per-user column instead.
      actor: {
        taxId: entity.osekMurshe,
        email: actorRow?.email ?? null,
      },
      customer: customer
        ? {
            taxId: customer.taxId ?? null,
            name: customer.name,
            address: customer.address ?? null,
          }
        : null,
      reference: invoice.referencesDocumentId
        ? await resolveReference(invoice.referencesDocumentId)
        : undefined,
      actionCode,
      accountingSoftwareNumber,
    });
    const payloadHash = computePayloadHash(payload);
    const correlationId = randomUUID();

    // 5) Insert (or resurrect) the submissions row to capture the
    // in-flight request before we make the HTTP call. ON CONFLICT
    // resets the timing fields so the retry cron has a clean slate.
    const submissionId = await db.transaction(async (tx) => {
      const submittedAt = new Date();
      const [inserted] = await tx
        .insert(shaamSubmissions)
        .values({
          documentId: invoice.id,
          businessEntityId: invoice.businessEntityId,
          environment: shaamEnvironment,
          actionCode,
          idempotencyKey,
          requestPayload: payload as unknown as Record<string, unknown>,
          requestPayloadHash: payloadHash,
          submittedAt,
        })
        .onConflictDoUpdate({
          target: [shaamSubmissions.idempotencyKey, shaamSubmissions.environment],
          set: {
            submittedAt,
            requestPayload: payload as unknown as Record<string, unknown>,
            requestPayloadHash: payloadHash,
            responsePayload: null,
            responseHttpStatus: null,
            responseAllocationNumber: null,
            responseStatus: null,
            responseErrorCode: null,
            responseErrorMessage: null,
            requestId: null,
            respondedAt: null,
            durationMs: null,
          },
        })
        .returning({ id: shaamSubmissions.id });

      await tx
        .update(outboundInvoices)
        .set({
          shaamStatus: "PENDING",
          shaamActionCode: actionCode,
          shaamSubmittedAt: submittedAt,
          shaamIdempotencyKey: idempotencyKey,
          shaamResponseAt: null,
          shaamLastErrorCode: null,
          shaamLastErrorMessage: null,
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: submittedAt,
        })
        .where(eq(outboundInvoices.id, invoice.id));

      await appendAuditEntry({
        tx,
        businessEntityId: invoice.businessEntityId,
        userId: invoice.userId,
        documentId: invoice.id,
        documentType: invoice.documentType,
        eventType: "SHAAM_SUBMITTED",
        eventPayload: {
          skipped: false,
          actionCode,
          idempotencyKey: idempotencyKey.slice(0, 12) + "…",
          payloadHash: payloadHash.slice(0, 12) + "…",
          correlationId,
        },
        actor: { userId: params.actorUserId },
      });
      return inserted.id;
    });

    // 6) Fire the HTTP request OUTSIDE the DB transaction.
    if (forcedOutcome) {
      console.warn(
        `[shaam] sandbox mock: forcing "${forcedOutcome.kind}" for ${invoice.id} (admin setting) — no request sent to the ITA.`,
      );
      return recordResult(
        params.documentId,
        submissionId,
        actionCode,
        mockShaamResult(forcedOutcome),
        { voluntary: Boolean(params.voluntary) },
      );
    }
    if (entity.shaamSandbox) {
      const url = clearanceUrl ?? "";
      if (!url.includes("/tsandbox/") || url.includes("/production/")) {
        throw new Error(
          "Sandbox SHAAM clearance refused: URL is not the ITA test path",
        );
      }
    }
    let httpResult: ShaamSubmitResult;
    try {
      httpResult = await submitInvoice({
        accessToken,
        payload,
        idempotencyKey,
        correlationId,
        clearanceUrl,
      });
    } catch (err) {
      if (err instanceof ShaamAuthorizationError) {
        await recordResult(params.documentId, submissionId, actionCode, {
          result: "REJECTED",
          errorCode: "auth_" + err.reason,
          errorMessage: err.message,
          requestId: null,
          httpStatus: 401,
          elapsedMs: 0,
          rawResponse: null,
        });
        return {
          shaamStatus: "PENDING",
          allocationNumber: null,
          submissionId,
          skipped: false,
        };
      }
      httpResult = {
        result: "NETWORK_ERROR",
        cause: err instanceof Error ? err : new Error(String(err)),
        elapsedMs: 0,
      };
    }

    return recordResult(params.documentId, submissionId, actionCode, httpResult, {
      voluntary: Boolean(params.voluntary),
    });
  };

  if (isShaamTenantSubmitSerializeEnabled()) {
    const gated = await withShaamTenantSubmitLock(
      invoice.businessEntityId,
      runShaamClearancePipeline,
    );
    if (!gated.ok) {
      if (invoice.shaamSubmittedAt == null) {
        await db
          .update(outboundInvoices)
          .set({
            shaamStatus: "PENDING",
            shaamSubmittedAt: new Date(),
            // See the `concurrent_in_flight` path above: without this the
            // document stays on rung 0 and the cron retries it every run
            // indefinitely. With it, the fresh `shaamSubmittedAt` and the
            // rising rung give real exponential backoff, and a tenant
            // whose lock is contended for nine hours ends up UNRESOLVED
            // in front of a human instead of looping unseen.
            shaamRetryCount: sql`${outboundInvoices.shaamRetryCount} + 1`,
            version: sql`${outboundInvoices.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(outboundInvoices.id, invoice.id));
      }
      return {
        shaamStatus: "PENDING",
        allocationNumber: null,
        submissionId: null,
        skipped: true,
        skippedReason: "tenant_shaam_serialize_busy",
      };
    }
    return gated.result;
  }

  return await runShaamClearancePipeline();
}

async function resolveReference(referencedDocumentId: string): Promise<{
  originalFormattedNumber: string;
  originalAllocationNumber: string | null;
}> {
  const [row] = await db
    .select({
      formattedNumber: outboundInvoices.formattedNumber,
      allocationNumber: outboundInvoices.allocationNumber,
    })
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, referencedDocumentId))
    .limit(1);
  if (!row) {
    throw new Error(
      `resolveReference: original document ${referencedDocumentId} not found`,
    );
  }
  // Credit notes can only reference issued documents, which by definition
  // already carry a fiscal number. A null here would mean we somehow
  // followed a draft link, which the validateCreditNoteRequest pre-check
  // should have caught.
  if (row.formattedNumber == null) {
    throw new Error(
      `resolveReference: referenced document ${referencedDocumentId} has no allocated fiscal number`,
    );
  }
  return {
    originalFormattedNumber: row.formattedNumber,
    originalAllocationNumber: row.allocationNumber ?? null,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Route B (spec §2.2.2): the special allocation number for an action-3
 * request means the ITA accepted the reverse charge. The refused original
 * — the invoice with VAT that the replacement stands in for — is now
 * cancelled (storno): voided in place, its number kept in the series with
 * the reason, and excluded with its cancellation from the VAT report.
 * Recorded from every path that can receive this answer (issue, manual
 * retry, the cron, the sandbox mock), in the same transaction as the
 * replacement's approval.
 */
async function recordReverseChargeStornoTx(
  tx: Tx,
  params: {
    /** The replacement — the document the action-3 request was for. */
    documentId: string;
    actorUserId: string;
    allocationNumber: string | null;
  },
): Promise<void> {
  const [replacement] = await tx
    .select({
      reverseChargeReplacesId: outboundInvoices.reverseChargeReplacesId,
      formattedNumber: outboundInvoices.formattedNumber,
    })
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, params.documentId))
    .limit(1);
  const originalId = replacement?.reverseChargeReplacesId;
  if (!originalId) {
    throw new Error(
      `Action-3 approval for ${params.documentId}, which replaces no refused invoice.`,
    );
  }
  const [original] = await tx
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, originalId))
    .limit(1);
  if (!original) throw new Error(`Refused invoice not found: ${originalId}`);
  // A retry of an approval already recorded: the storno is done.
  if (original.status === "voided" && original.shaamRejectionChoice === "reverse_charge") {
    return;
  }

  const [refusal] = await tx
    .select({
      id: shaamSubmissions.id,
      requestPayload: shaamSubmissions.requestPayload,
      responseStatus: shaamSubmissions.responseStatus,
      responseErrorCode: shaamSubmissions.responseErrorCode,
    })
    .from(shaamSubmissions)
    .where(
      and(
        eq(shaamSubmissions.documentId, original.id),
        eq(shaamSubmissions.actionCode, 1),
        inArray(shaamSubmissions.responseStatus, ["REJECTED", "HELD"]),
      ),
    )
    .orderBy(desc(shaamSubmissions.submittedAt))
    .limit(1);

  const now = new Date();
  await tx
    .update(outboundInvoices)
    .set({
      status: "voided",
      shaamStatus: "CANCELLED_AFTER_REJECTION",
      shaamRejectionChoice: "reverse_charge",
      // Normally already set when the replacement was created; kept if so.
      shaamRejectionChoiceAt: original.shaamRejectionChoiceAt ?? now,
      shaamRejectionChoiceBy: original.shaamRejectionChoiceBy ?? params.actorUserId,
      version: sql`${outboundInvoices.version} + 1`,
      updatedAt: now,
    })
    .where(eq(outboundInvoices.id, original.id));
  const payload = (refusal?.requestPayload ?? {}) as Record<string, unknown>;
  await appendAuditEntry({
    tx,
    businessEntityId: original.businessEntityId,
    userId: original.userId,
    documentId: original.id,
    documentType: original.documentType,
    eventType: "SHAAM_REJECTION_RESOLVED",
    eventPayload: {
      phase: "storno",
      choice: "reverse_charge",
      specialAllocationNumber: params.allocationNumber,
      replacementId: params.documentId,
      replacementFormattedNumber: replacement.formattedNumber,
      // The number stays in the series; this entry explains it.
      stornoFormattedNumber: original.formattedNumber,
      stornoSequenceNumber: original.sequenceNumber,
      stornoOfSubmissionId: refusal?.id ?? null,
      stornoOfResponseStatus: refusal?.responseStatus ?? null,
      stornoOfErrorCode: refusal?.responseErrorCode ?? null,
      stornoOfVatAmount: payload.vat_amount ?? original.vatAmount ?? null,
    },
    actor: { userId: params.actorUserId },
  });
}

/**
 * Local approval for a sandboxed entity with no UAT grant.
 * Does not call ITA. The allocation number is prefixed `TEST-`.
 */
async function approveSandboxMock(params: {
  invoice: {
    id: string;
    businessEntityId: string;
    userId: string;
    documentType: (typeof outboundInvoices.$inferSelect)["documentType"];
    version: number;
  };
  actorUserId: string;
  actionCode: ShaamActionCode;
}): Promise<SubmitResultShape> {
  const allocationNumber = sandboxMockAllocationNumber(params.invoice.id);
  const now = new Date();
  const idempotencyKey = computeIdempotencyKey({
    businessEntityId: params.invoice.businessEntityId,
    documentId: params.invoice.id,
    actionCode: params.actionCode,
    version: params.invoice.version,
  });
  const rawResponse = {
    sandbox: true,
    source: "mock",
    ita_request: false,
    approved: true,
    confirmation_number: allocationNumber,
  };

  const submissionId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(shaamSubmissions)
      .values({
        documentId: params.invoice.id,
        businessEntityId: params.invoice.businessEntityId,
        environment: "UAT",
        actionCode: params.actionCode,
        idempotencyKey,
        requestPayload: { sandbox: true, source: "mock", ita_request: false },
        requestPayloadHash: createHash("sha256")
          .update(`${params.invoice.id}:${allocationNumber}`, "utf8")
          .digest("hex"),
        responsePayload: rawResponse,
        responseHttpStatus: null,
        responseAllocationNumber: allocationNumber,
        responseStatus: "APPROVED",
        responseErrorCode: null,
        responseErrorMessage: null,
        requestId: null,
        submittedAt: now,
        respondedAt: now,
        durationMs: 0,
      })
      .onConflictDoUpdate({
        target: [shaamSubmissions.idempotencyKey, shaamSubmissions.environment],
        set: {
          responsePayload: rawResponse,
          responseAllocationNumber: allocationNumber,
          responseStatus: "APPROVED",
          responseHttpStatus: null,
          respondedAt: now,
          durationMs: 0,
        },
      })
      .returning({ id: shaamSubmissions.id });

    await tx
      .update(outboundInvoices)
      .set({
        shaamStatus: "APPROVED",
        allocationNumber,
        shaamActionCode: params.actionCode,
        shaamSubmittedAt: now,
        shaamResponseAt: now,
        shaamIdempotencyKey: idempotencyKey,
        shaamRequestId: null,
        shaamLastErrorCode: null,
        shaamLastErrorMessage: null,
        // `recordResult` clears this on a real approval; the mock set
        // APPROVED directly and skipped it, so a sandbox entity that had
        // been HELD kept a deadline that now reads as a live one the
        // seller still has to act on.
        shaamHearingDeadline: null,
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: now,
      })
      .where(eq(outboundInvoices.id, params.invoice.id));

    await appendAuditEntry({
      tx,
      businessEntityId: params.invoice.businessEntityId,
      userId: params.invoice.userId,
      documentId: params.invoice.id,
      documentType: params.invoice.documentType,
      eventType: "SHAAM_ALLOCATION_RECEIVED",
      eventPayload: {
        sandbox: true,
        source: "mock",
        ita_request: false,
        actionCode: params.actionCode,
        allocationNumber,
      },
      actor: { userId: params.actorUserId },
    });

    if (params.actionCode === 3) {
      await recordReverseChargeStornoTx(tx, {
        documentId: params.invoice.id,
        actorUserId: params.actorUserId,
        allocationNumber,
      });
    }

    return inserted.id;
  });

  return {
    shaamStatus: "APPROVED",
    allocationNumber,
    submissionId,
    skipped: false,
  };
}

/**
 * Writes the terminal state (APPROVED / REJECTED / HELD / outage)
 * into both the submission row and the document row, and emits the
 * appropriate audit event. Single tx so nothing drifts.
 */
async function recordResult(
  documentId: string,
  submissionId: string,
  actionCode: ShaamActionCode,
  result: ShaamSubmitResult,
  opts?: { voluntary?: boolean },
): Promise<SubmitResultShape> {
  const now = new Date();
  let mappedStatus: ShaamStatus;
  let allocationNumber: string | null = null;
  let voluntaryDeclined = false;
  let auditEvent: "SHAAM_ALLOCATION_RECEIVED" | "SHAAM_REJECTED";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let httpStatus: number | null = null;
  let durationMs: number | null = null;
  let requestId: string | null = null;
  // Only a hold carries one. `undefined` leaves the column untouched;
  // `null` actively clears a stale deadline once the hold is resolved.
  let hearingDeadline: Date | null | undefined = undefined;
  let responseStatusLabel:
    | "APPROVED"
    | "REJECTED"
    | "HELD"
    | "TIMEOUT"
    | "NETWORK_ERROR";
  let rawResponse: unknown = null;

  switch (result.result) {
    case "APPROVED":
      mappedStatus = "APPROVED";
      allocationNumber = result.allocationNumber;
      // The hold is over — leaving the old date on the row would read as
      // a deadline the seller still has to act on.
      hearingDeadline = null;
      auditEvent = "SHAAM_ALLOCATION_RECEIVED";
      httpStatus = result.httpStatus;
      durationMs = result.elapsedMs;
      requestId = result.requestId;
      responseStatusLabel = "APPROVED";
      rawResponse = result.rawResponse;
      break;
    case "REJECTED":
      // A 5xx is the ITA's server failing, not the ITA refusing. The
      // client comment has long claimed this promotion happened here; it
      // did not, so an ITA outage was being written onto the document as
      // a terminal refusal — telling the seller they had been rejected
      // when nobody had looked at the invoice yet. Treat it like any
      // other outage so the retry cron chases it.
      //
      // A 422 is the same shape of problem from the seller's side: the
      // ITA rejected our *request*, not their invoice — the invoice was
      // never assessed. Writing REJECTED told them the Tax Authority had
      // refused them, over a schema mismatch in our payload builder that
      // they cannot see, let alone fix. OUTAGE_ISSUED is what they
      // already read as "issued without allocation, auto-retry in
      // progress" (the copy names no cause), and it puts the document on
      // the retry ladder, so shipping a payload fix clears the backlog
      // by itself instead of needing a sweep.
      mappedStatus =
        result.httpStatus >= 500 || result.httpStatus === 422
          ? "OUTAGE_ISSUED"
          : "REJECTED";
      errorCode = result.errorCode;
      errorMessage = result.errorMessage;
      httpStatus = result.httpStatus;
      durationMs = result.elapsedMs;
      requestId = result.requestId;
      auditEvent = "SHAAM_REJECTED";
      // The submissions log keeps saying REJECTED for a 422: the ITA did
      // reject that request, and the admin view is where we go to find
      // our own bugs. Only the seller-facing status is softened.
      responseStatusLabel =
        result.httpStatus >= 500 ? "NETWORK_ERROR" : "REJECTED";
      rawResponse = result.rawResponse;
      break;
    case "HELD":
      mappedStatus = "HELD";
      hearingDeadline = result.hearingDeadline;
      errorCode = result.errorCode;
      errorMessage = result.errorMessage;
      httpStatus = result.httpStatus;
      durationMs = result.elapsedMs;
      requestId = result.requestId;
      auditEvent = "SHAAM_REJECTED";
      responseStatusLabel = "HELD";
      rawResponse = result.rawResponse;
      break;
    case "TIMEOUT":
      mappedStatus = "OUTAGE_ISSUED";
      errorCode = "timeout";
      errorMessage = "SHAAM clearance request timed out";
      durationMs = result.elapsedMs;
      auditEvent = "SHAAM_REJECTED";
      responseStatusLabel = "TIMEOUT";
      break;
    case "NETWORK_ERROR":
      mappedStatus = "OUTAGE_ISSUED";
      errorCode = "network_error";
      errorMessage = result.cause.message;
      durationMs = result.elapsedMs;
      auditEvent = "SHAAM_REJECTED";
      responseStatusLabel = "NETWORK_ERROR";
      break;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(shaamSubmissions)
      .set({
        responsePayload: rawResponse as Record<string, unknown> | null,
        responseHttpStatus: httpStatus,
        responseAllocationNumber: allocationNumber,
        responseStatus: responseStatusLabel,
        responseErrorCode: errorCode,
        responseErrorMessage: errorMessage,
        requestId,
        respondedAt: now,
        durationMs,
      })
      .where(eq(shaamSubmissions.id, submissionId));

    const [invoice] = await tx
      .select({
        userId: outboundInvoices.userId,
        businessEntityId: outboundInvoices.businessEntityId,
        documentType: outboundInvoices.documentType,
      })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, documentId))
      .limit(1);
    if (!invoice) throw new Error("document vanished mid-submission");

    // A number the seller asked for out of courtesy, refused: the invoice
    // was never obliged to carry one, so its stored status must not be a
    // refusal. The caller is told separately (`voluntaryDeclined`) and
    // pauses issuance. `responseStatusLabel` is left alone — the
    // submissions log should record exactly what the ITA said.
    const declined =
      Boolean(opts?.voluntary) &&
      (mappedStatus === "REJECTED" || mappedStatus === "HELD");
    voluntaryDeclined = declined;
    if (opts?.voluntary && mappedStatus !== "APPROVED") {
      mappedStatus = "NOT_REQUIRED";
      allocationNumber = null;
    }

    await tx
      .update(outboundInvoices)
      .set({
        shaamStatus: mappedStatus,
        allocationNumber: allocationNumber ?? undefined,
        shaamResponseAt: now,
        shaamRequestId: requestId,
        shaamLastErrorCode: errorCode,
        shaamLastErrorMessage: errorMessage,
        ...(hearingDeadline !== undefined
          ? { shaamHearingDeadline: hearingDeadline }
          : {}),
        ...(mappedStatus === "OUTAGE_ISSUED"
          ? { shaamRetryCount: sql`${outboundInvoices.shaamRetryCount} + 1` }
          : {}),
        // Paces the slow hold ladder in `/api/cron/shaam-retry-pending`.
        // Without it the count stays at zero and a hold is re-asked on the
        // ladder's first rung forever instead of backing off toward daily.
        ...(mappedStatus === "HELD"
          ? {
              shaamHoldPollCount: sql`${outboundInvoices.shaamHoldPollCount} + 1`,
            }
          : {}),
        version: sql`${outboundInvoices.version} + 1`,
        updatedAt: now,
      })
      .where(eq(outboundInvoices.id, documentId));

    // Route B (spec §2.2.2): the special allocation number for an action-3
    // request means the ITA accepted the reverse charge, and the refused
    // original is cancelled (storno). Recorded here because every path
    // that can receive this answer (issue, manual retry, the cron) comes
    // through this function.
    if (actionCode === 3 && mappedStatus === "APPROVED") {
      await recordReverseChargeStornoTx(tx, {
        documentId,
        actorUserId: invoice.userId,
        allocationNumber,
      });
    }

    await appendAuditEntry({
      tx,
      businessEntityId: invoice.businessEntityId,
      userId: invoice.userId,
      documentId,
      documentType: invoice.documentType,
      eventType: auditEvent,
      eventPayload: {
        actionCode,
        responseStatus: responseStatusLabel,
        allocationNumber,
        errorCode,
        errorMessage,
        httpStatus,
        durationMs,
        requestId,
        hearingDeadline: hearingDeadline?.toISOString() ?? null,
      },
      actor: { userId: invoice.userId },
    });
  });

  return {
    shaamStatus: mappedStatus,
    allocationNumber,
    submissionId,
    skipped: false,
    voluntaryDeclined,
  };
}
