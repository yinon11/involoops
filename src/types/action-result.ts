/**
 * Discriminated-union result for server actions that can fail with a
 * user-facing message.
 *
 * Why this exists
 * ---------------
 * Throwing from a Next.js server action that is invoked from a client
 * component renders as the generic
 *
 *   "An error occurred in the Server Components render. The specific
 *    message is omitted in production builds…"
 *
 * because Next.js redacts the original message in production. That makes
 * validation errors useless to the end user.
 *
 * The fix is to *return* validation failures instead of throwing them, so
 * the message survives the server→client boundary intact. Callers
 * destructure the result, show the message via their normal feedback
 * channel (toast / inline error), and only `throw` for truly exceptional
 * paths (network, DB unavailable, programmer error) where the generic
 * "something went wrong" UI is acceptable.
 */
export type ActionResult =
  | { success: true }
  | { success: false; error: string };

/** Convenience: action that also returns data on success. */
export type ActionResultWith<T> =
  | ({ success: true } & T)
  | { success: false; error: string };
