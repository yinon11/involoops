/**
 * Minimal Invoices v2 Approval probe — validates that the current OAuth
 * access token is accepted by the clearance API gateway (distinct from
 * `getActiveAccessToken`, which only hits the token endpoint).
 *
 * Does not write to `shaam_submissions` or mutate invoices.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { businessEntities } from "@/db/schema";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";
import { getActiveAccessToken } from "./authorization";
import {
  getShaamClearanceBaseUrl,
  getShaamInvoicePath,
  submitInvoice,
} from "./client";
import { ShaamApiError, ShaamAuthorizationError } from "./errors";
import { buildShaamPayload } from "./payload";

function resolveAccountingSoftwareNumber(): string {
  const issued = process.env.SHAAM_ACCOUNTING_SOFTWARE_NUMBER?.trim();
  if (issued) return issued;
  const houseVat = process.env.SOFTWARE_HOUSE_VAT_NUMBER?.trim();
  if (houseVat) return houseVat;
  throw new Error(
    "SHAAM clearance probe: set SHAAM_ACCOUNTING_SOFTWARE_NUMBER or SOFTWARE_HOUSE_VAT_NUMBER.",
  );
}

/** ITA sandbox accepts fictional customer VATs (portal test data). */
function resolveProbeCustomerVat(): string {
  const fromEnv = process.env.SHAAM_PROBE_CUSTOMER_VAT?.trim();
  if (fromEnv) return fromEnv;
  return "777777715";
}

export type ProbeClearanceOutcome =
  | "approved"
  | "business_response"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "other_http"
  | "network"
  | "not_configured";

export interface ProbeClearanceResult {
  ok: boolean;
  outcome: ProbeClearanceOutcome;
  httpStatus: number | null;
  summary: string;
  requestId: string | null;
  clearanceUrl: string;
  elapsedMs: number | null;
}

function clearanceUrl(): string {
  return new URL(getShaamInvoicePath(), getShaamClearanceBaseUrl()).toString();
}

export async function probeShaamClearance(params: {
  businessEntityId: string;
  environment?: ShaamEnvironment;
}): Promise<ProbeClearanceResult> {
  const url = clearanceUrl();
  const [entity] = await db
    .select({
      osekMurshe: businessEntities.osekMurshe,
      legalName: businessEntities.legalName,
      shaamSandbox: businessEntities.shaamSandbox,
    })
    .from(businessEntities)
    .where(eq(businessEntities.id, params.businessEntityId))
    .limit(1);

  if (entity?.shaamSandbox) {
    return {
      ok: false,
      outcome: "not_configured",
      httpStatus: null,
      summary:
        "Sandbox business entities do not call ITA. Allocation is mocked unless this entity has an active UAT grant, and the probe never sends a request.",
      requestId: null,
      clearanceUrl: url,
      elapsedMs: null,
    };
  }

  if (!entity?.osekMurshe?.trim()) {
    return {
      ok: false,
      outcome: "not_configured",
      httpStatus: null,
      summary: "Business entity has no tax ID (osek murshe).",
      requestId: null,
      clearanceUrl: url,
      elapsedMs: null,
    };
  }

  let accessToken: string;
  try {
    accessToken = await getActiveAccessToken({
      businessEntityId: params.businessEntityId,
      environment: params.environment,
    });
  } catch (err) {
    if (err instanceof ShaamAuthorizationError) {
      return {
        ok: false,
        outcome: "unauthorized",
        httpStatus: null,
        summary: `Cannot obtain access token (${err.reason}). Re-authorize with ITA first.`,
        requestId: null,
        clearanceUrl: url,
        elapsedMs: null,
      };
    }
    throw err;
  }

  const probeId = `involoops-probe-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const payload = buildShaamPayload({
    invoice: {
      id: randomUUID(),
      formattedNumber: probeId,
      documentType: "TAX_INVOICE",
      invoiceDate: today,
      items: [
        {
          description: "involoops clearance probe",
          quantity: 1,
          unitPrice: 100,
          total: 100,
        },
      ],
      subtotal: "100",
      vatRate: "18",
      vatAmount: "18",
      total: "118",
      currency: "ILS",
      notes: null,
    },
    businessEntity: { osekMurshe: entity.osekMurshe },
    actor: { taxId: entity.osekMurshe, email: "probe@involoops.internal" },
    customer: {
      taxId: resolveProbeCustomerVat(),
      name: "clearance probe",
      address: null,
    },
    actionCode: 1,
    accountingSoftwareNumber: resolveAccountingSoftwareNumber(),
    issuanceDate: new Date(),
  });

  try {
    const result = await submitInvoice({
      accessToken,
      payload,
      idempotencyKey: `probe:${params.businessEntityId}:${probeId}`,
      correlationId: randomUUID(),
    });

    if (result.result === "APPROVED") {
      return {
        ok: true,
        outcome: "approved",
        httpStatus: result.httpStatus,
        summary:
          "Clearance API accepted the token and returned an allocation (unexpected for a probe invoice).",
        requestId: result.requestId,
        clearanceUrl: url,
        elapsedMs: result.elapsedMs,
      };
    }
    if (result.result === "HELD" || result.result === "REJECTED") {
      const tokenOk = result.httpStatus >= 200 && result.httpStatus < 300;
      return {
        ok: tokenOk,
        outcome: tokenOk ? "business_response" : "other_http",
        httpStatus: result.httpStatus,
        summary: tokenOk
          ? `Clearance API accepted the token (HTTP ${result.httpStatus}). Business response: ${result.errorCode ?? "n/a"} — ${result.errorMessage}`
          : `Clearance HTTP ${result.httpStatus}: ${result.errorMessage}`,
        requestId: result.requestId,
        clearanceUrl: url,
        elapsedMs: result.elapsedMs,
      };
    }
    if (result.result === "TIMEOUT") {
      return {
        ok: false,
        outcome: "network",
        httpStatus: null,
        summary: "Clearance request timed out.",
        requestId: null,
        clearanceUrl: url,
        elapsedMs: result.elapsedMs,
      };
    }
    return {
      ok: false,
      outcome: "network",
      httpStatus: null,
      summary: result.cause.message,
      requestId: null,
      clearanceUrl: url,
      elapsedMs: result.elapsedMs,
    };
  } catch (err) {
    if (err instanceof ShaamAuthorizationError) {
      const api =
        err.cause instanceof ShaamApiError ? err.cause : null;
      const more =
        api?.itaMessage ??
        "ITA rejected the bearer token for Invoices v2 Approval (OAuth can still work).";
      return {
        ok: false,
        outcome: "unauthorized",
        httpStatus: api?.httpStatus ?? 401,
        summary: `HTTP ${api?.httpStatus ?? 401}: ${more}`,
        requestId: api?.requestId ?? null,
        clearanceUrl: url,
        elapsedMs: null,
      };
    }
    if (err instanceof ShaamApiError) {
      const outcome: ProbeClearanceOutcome =
        err.httpStatus === 403 ? "forbidden" : "other_http";
      return {
        ok: false,
        outcome,
        httpStatus: err.httpStatus,
        summary: err.itaMessage ?? err.message,
        requestId: err.requestId,
        clearanceUrl: url,
        elapsedMs: null,
      };
    }
    return {
      ok: false,
      outcome: "network",
      httpStatus: null,
      summary: err instanceof Error ? err.message : String(err),
      requestId: null,
      clearanceUrl: url,
      elapsedMs: null,
    };
  }
}
