/**
 * ITA clearance error codes, in language a seller can act on.
 *
 * The raw `errorMessage` from שע"ם is written for an integrator: terse,
 * sometimes English, sometimes naming a field by its spec name. Showing it
 * verbatim — which is what we used to do — leaves the seller with a string
 * and no idea whether to fix their data, call their accountant, or wait.
 *
 * This maps the codes we recognise onto a short explanation and the thing
 * to do about it. The ITA's own text is always still shown alongside: an
 * accountant will ask for it, and a mapping that quietly replaced it would
 * lose the only authoritative record of what was said.
 *
 * Unknown codes deliberately return null rather than a generic sentence.
 * Inventing an explanation for a code we have never seen is worse than
 * showing the ITA's words and letting the seller ask.
 */

export type ShaamErrorAction =
  /** The seller can fix this themselves on the draft. */
  | "fix_document"
  /** The customer's registration details are the problem. */
  | "fix_customer"
  /** Our own configuration or authorization, not the seller's data. */
  | "contact_support"
  /** A decision at the ITA — accountant territory. */
  | "contact_accountant"
  /** Transient; another attempt is the right move. */
  | "retry";

export interface ShaamErrorExplanation {
  /** i18n key suffix under `shaamSubmission.rejection.reason.*`. */
  reasonKey: string;
  action: ShaamErrorAction;
}

/**
 * Codes are strings because that is how `client.ts` extracts them — the v2
 * payload carries numbers, v1 carried strings, and our own synthetic codes
 * (`auth_expired`, `timeout`) are neither.
 */
const CODES: Record<string, ShaamErrorExplanation> = {
  // Documented v2 clearance outcomes.
  "460": { reasonKey: "pendingDecision", action: "contact_accountant" },
  "461": { reasonKey: "pendingDecision", action: "contact_accountant" },
  "462": { reasonKey: "administrative", action: "contact_accountant" },

  // Validation failures seen in UAT.
  "10": { reasonKey: "code_10", action: "contact_support" },
  "20": { reasonKey: "code_20", action: "contact_support" },
  "30": { reasonKey: "code_30", action: "fix_customer" },
  "40": { reasonKey: "code_40", action: "fix_document" },
  "50": { reasonKey: "code_50", action: "fix_document" },
  "434": { reasonKey: "code_434", action: "fix_document" },

  // Ours, not theirs.
  no_allocation_number: {
    reasonKey: "code_no_allocation_number",
    action: "contact_support",
  },
  auth_expired: { reasonKey: "ourFault", action: "contact_support" },
  auth_revoked: { reasonKey: "ourFault", action: "contact_support" },
  auth_never_authorized: { reasonKey: "ourFault", action: "contact_support" },
  auth_pending: { reasonKey: "ourFault", action: "contact_support" },
  auth_error: { reasonKey: "ourFault", action: "contact_support" },
  timeout: { reasonKey: "ourFault", action: "retry" },
  network_error: { reasonKey: "ourFault", action: "retry" },
  max_retries_exceeded: { reasonKey: "ourFault", action: "retry" },
};

/**
 * What the HTTP status itself means, per the v2.0 spec's own table (§5).
 *
 * This is the dimension the code-based map above cannot see. `client.ts`
 * maps every 4xx except 401/409 to REJECTED, so a malformed request of
 * ours and a refusal on the merits arrived at the seller as the same
 * sentence: "נדחה על ידי רשות המסים". They are not the same thing, and
 * only one of them is the seller's to do anything about.
 *
 *   400  "Request includes logical incorrect data"  — the data is wrong
 *   406  "Check permission for the vat_number (or customer_vat_number
 *        in case of paragraph 3)"                    — a permission
 *   422  "One or more of the parameters don't match the schema"
 *                                                    — OUR payload is bad
 *
 * 401 and 409 never reach here: `client.ts` branches on them first
 * (authorization, and a hold with its hearing deadline). A refusal on the
 * merits is 200 + approved=false + code 462, which has no entry here
 * precisely because its HTTP status says nothing.
 */
const HTTP_SEMANTICS: Record<number, ShaamErrorExplanation> = {
  400: { reasonKey: "http_400", action: "fix_document" },
  // Deliberately the accountant and not support: the fix is a
  // registration or authorization at the ITA, which we cannot make.
  406: { reasonKey: "http_406", action: "contact_accountant" },
  // Ours. A seller can do nothing about a schema mismatch, and telling
  // them to "fix and retry" would send them round a loop they cannot win.
  422: { reasonKey: "http_422", action: "contact_support" },
};

export function explainShaamHttpStatus(
  httpStatus: number | null | undefined,
): ShaamErrorExplanation | null {
  if (httpStatus == null) return null;
  return HTTP_SEMANTICS[httpStatus] ?? null;
}

export function explainShaamError(
  errorCode: string | null | undefined,
): ShaamErrorExplanation | null {
  const code = errorCode?.trim();
  if (!code) return null;
  return CODES[code] ?? null;
}
