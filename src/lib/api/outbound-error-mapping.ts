import { ApiError } from "@/lib/api/errors";
import { OUTBOUND_DOCUMENTS_LOCKED_MESSAGE } from "@/lib/outbound/ita-issuance-gate";

export function outboundDocumentsLockedApiError(): ApiError {
  return new ApiError({
    code: "ita_approval_required",
    status: 403,
    title: "Issuing is waiting for ITA approval",
    detail: OUTBOUND_DOCUMENTS_LOCKED_MESSAGE,
  });
}

/**
 * Translate domain errors thrown by the outbound operations into the
 * Problem Details vocabulary the API exposes. Anything we don't
 * recognise becomes a 500 — the route handler logs it via runApiRoute.
 */
export function mapOutboundDomainError(err: unknown): ApiError {
  // Drizzle wraps the underlying driver error in a `DrizzleQueryError`
  // whose own `.message` only carries the failed SQL + params. The
  // *actual* reason (FK violation, NOT NULL, unique conflict, etc.) is
  // on `err.cause`. Unwrap it up-front so every branch below — and the
  // 500 fallback — has the real reason to log / surface.
  const driver = unwrapDriverError(err);
  const message =
    driver?.message ?? (err instanceof Error ? err.message : "unexpected");

  // Postgres SQLSTATE classes worth turning into structured 4xx
  // responses instead of generic 500s. Drizzle stack traces are useless
  // to API consumers; the SQLSTATE + constraint name is what they need
  // to fix their request.
  if (driver?.code) {
    const apiErr = mapPostgresError(driver);
    if (apiErr) return apiErr;
  }

  if (err instanceof Error) {
    const name = err.constructor.name;
    if (name === "OutboundDocumentsLockedError") {
      return outboundDocumentsLockedApiError();
    }
    if (name === "CannotVoidDocumentTypeError") {
      return new ApiError({
        code: "cannot_void_document_type",
        status: 422,
        title: "This document type cannot be voided",
        detail: message,
      });
    }
    if (name === "IssuerNotReadyError") {
      return new ApiError({
        code: "validation_failed",
        status: 422,
        title: "Business entity is not ready to issue invoices",
        detail: message,
      });
    }
    if (name === "InvoicePaymentValidationError") {
      return new ApiError({
        code: "validation_failed",
        status: 422,
        title: "Payment validation failed",
        detail: message,
      });
    }
  }

  if (/Invalid invoice date/i.test(message)) {
    return new ApiError({
      code: "validation_failed",
      status: 422,
      title: "Invalid invoice date",
      detail: message,
    });
  }
  if (/Invoice not found/i.test(message)) {
    return new ApiError({
      code: "not_found",
      status: 404,
      title: "Invoice not found",
    });
  }
  if (/Cannot edit a document in status/i.test(message)) {
    return new ApiError({
      code: "document_immutable",
      status: 409,
      title: "Document is immutable",
      detail: message,
    });
  }
  if (/Cannot delete a document/i.test(message)) {
    return new ApiError({
      code: "document_immutable",
      status: 409,
      title: "Cannot delete a non-draft document",
      detail: message,
    });
  }
  if (/Illegal status transition/i.test(message)) {
    return new ApiError({
      code: "conflict",
      status: 409,
      title: "Illegal status transition",
      detail: message,
    });
  }
  if (
    /Use issueOutboundInvoice/i.test(message) ||
    /draft to issued/i.test(message)
  ) {
    return new ApiError({
      code: "conflict",
      status: 409,
      title: "Use the /issue endpoint to transition a draft to issued",
    });
  }
  if (/permission/i.test(message)) {
    return new ApiError({
      code: "missing_scope",
      status: 403,
      title: "Permission denied",
      detail: message,
    });
  }

  if (err instanceof ApiError) return err;
  return new ApiError({
    code: "internal_error",
    status: 500,
    title: "Outbound operation failed",
    detail: message,
  });
}

interface PgDriverError {
  message: string;
  /** Postgres SQLSTATE (e.g. "23503"). */
  code?: string;
  /** Constraint that fired the error, when applicable. */
  constraint_name?: string;
  /** Table that owns the constraint, when applicable. */
  table_name?: string;
  /** Column name on NOT NULL violations. */
  column_name?: string;
  /** Verbose secondary message — usually the human-readable hint. */
  detail?: string;
}

/**
 * Walk the `.cause` chain a couple of hops deep and return the first
 * driver-level error object we can read SQLSTATE / constraint name off
 * of. Drizzle wraps each query failure in `DrizzleQueryError`; nested
 * transactions can wrap that again, so we don't assume a fixed depth.
 */
function unwrapDriverError(err: unknown): PgDriverError | null {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ("code" in cur && typeof (cur as { code?: unknown }).code === "string") {
      return cur as PgDriverError;
    }
    if (!("cause" in cur)) return null;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

function mapPostgresError(driver: PgDriverError): ApiError | null {
  switch (driver.code) {
    // Foreign key violation. Almost always: caller supplied an id
    // (customer_id, template_id, …) that does not exist on this account
    // / environment. 422 instead of 500 — they can fix it client-side.
    case "23503": {
      const which = describeForeignKey(driver);
      return new ApiError({
        code: "validation_failed",
        status: 422,
        title: which
          ? `${which} not found`
          : "Referenced resource not found",
        detail: driver.detail ?? driver.message,
      });
    }
    // Unique violation — duplicate key.
    case "23505":
      return new ApiError({
        code: "conflict",
        status: 409,
        title: "Duplicate value violates a unique constraint",
        detail: driver.detail ?? driver.message,
      });
    // NOT NULL violation — caller (or app) tried to write a missing column.
    case "23502":
      return new ApiError({
        code: "validation_failed",
        status: 422,
        title: driver.column_name
          ? `Missing required field: ${driver.column_name}`
          : "Missing required field",
        detail: driver.detail ?? driver.message,
      });
    // CHECK constraint violation.
    case "23514":
      return new ApiError({
        code: "validation_failed",
        status: 422,
        title: driver.constraint_name
          ? `Constraint violated: ${driver.constraint_name}`
          : "Check constraint violated",
        detail: driver.detail ?? driver.message,
      });
    default:
      return null;
  }
}

/**
 * Pull a friendly noun out of a postgres FK constraint name when we
 * can — e.g. `outbound_invoices_customer_id_fkey` → `Customer`. Falls
 * back to the constraint name verbatim so debugging never loses info.
 */
function describeForeignKey(driver: PgDriverError): string | null {
  const name = driver.constraint_name ?? "";
  const match = /_(\w+)_id_fkey$/.exec(name);
  if (!match) return null;
  const noun = match[1].replace(/_/g, " ");
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}
