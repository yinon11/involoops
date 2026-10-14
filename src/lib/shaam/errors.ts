/**
 * Typed errors for SHAAM integration (Spec 07). Spec 08 re-imports
 * these so invoice-submission flows can map failures to specific UI
 * states (notably `expired` — "re-authorize with ITA" CTA).
 */

export type ShaamAuthorizationReason =
  | "never_authorized"
  | "pending"
  | "expired"
  | "revoked"
  | "error";

export class ShaamAuthorizationError extends Error {
  readonly reason: ShaamAuthorizationReason;
  readonly businessEntityId: string;
  override readonly cause?: unknown;
  constructor(
    reason: ShaamAuthorizationReason,
    businessEntityId: string,
    cause?: unknown,
  ) {
    super(
      `SHAAM authorization ${reason} for business entity ${businessEntityId}`,
    );
    this.reason = reason;
    this.businessEntityId = businessEntityId;
    this.cause = cause;
    this.name = "ShaamAuthorizationError";
  }
}

export class ShaamApiError extends Error {
  readonly httpStatus: number;
  readonly itaErrorCode: string | null;
  readonly itaMessage: string | null;
  readonly requestId: string | null;
  constructor(
    httpStatus: number,
    itaErrorCode: string | null,
    itaMessage: string | null,
    requestId: string | null,
  ) {
    super(
      `SHAAM API ${httpStatus}${itaErrorCode ? ` (${itaErrorCode})` : ""}${
        itaMessage ? `: ${itaMessage}` : ""
      }`,
    );
    this.httpStatus = httpStatus;
    this.itaErrorCode = itaErrorCode;
    this.itaMessage = itaMessage;
    this.requestId = requestId;
    this.name = "ShaamApiError";
  }
}
