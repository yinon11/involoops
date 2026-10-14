import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { ShaamSubmitResult } from "./client";

/**
 * Sandbox only: force the Tax Authority's answer, for testing the flows a
 * real test service will not produce on demand (a refusal, a hold, an
 * outage). Set from the admin panel (Admin → ITA integration), stored in
 * `app_settings`, effective on the next request — no restart.
 *
 * | value          | answer                                                        |
 * |----------------|---------------------------------------------------------------|
 * | (none)         | normal: the ITA test service when connected, else the local approval mock |
 * | `approve`      | local approval (`TEST-…` number), even when connected         |
 * | `reject`       | refused on the merits — v2 code 462, the four statutory alternatives |
 * | `reject:<code>`| refused with that code (e.g. `reject:30` — invalid customer VAT id) |
 * | `hold`         | held — v2 code 460, hearing deadline in 14 days               |
 * | `outage`       | no answer (timeout): issued as `OUTAGE_ISSUED`, chased by the cron |
 *
 * Two locks, both required: the stack is the sandbox
 * (`SIGNING_ENVIRONMENT=sandbox`, which its boot guard enforces) and the
 * ITA environment is not `PROD`. It then applies to every business on that
 * stack — all of it is test data — whether or not the business is flagged
 * `shaam_sandbox` (requiring the flag too made the override silently miss
 * unflagged test businesses, which went to the ITA test service instead).
 * On any other stack the setting can be neither read nor written. Every
 * forced answer is logged and recorded as such in the submission row.
 */
export type SandboxMockOutcome =
  | { kind: "approve" }
  | { kind: "reject"; code: string }
  | { kind: "hold" }
  | { kind: "outage" };

export const SANDBOX_MOCK_SETTING_KEY = "sandbox.shaam_mock_outcome";

/** Is this the sandbox stack, where the override may apply at all? */
export function isSandboxStack(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    (env.SIGNING_ENVIRONMENT ?? "").trim() === "sandbox" &&
    (env.SHAAM_ENV ?? "").trim().toUpperCase() !== "PROD"
  );
}

/** Parse a stored value; null for "normal" or anything unrecognised. */
export function parseSandboxMockOutcome(
  value: string | null | undefined,
): SandboxMockOutcome | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "approve") return { kind: "approve" };
  if (raw === "hold") return { kind: "hold" };
  if (raw === "outage") return { kind: "outage" };
  const reject = /^reject(?::([a-z0-9_]{1,32}))?$/.exec(raw);
  if (reject) return { kind: "reject", code: reject[1] ?? "462" };
  return null;
}

/** The override in force, or null. Always null off the sandbox stack. */
export async function getSandboxMockOutcome(): Promise<SandboxMockOutcome | null> {
  if (!isSandboxStack()) return null;
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SANDBOX_MOCK_SETTING_KEY))
    .limit(1);
  return parseSandboxMockOutcome(row?.value);
}

/** The stored value as the admin panel shows it ("" = normal). */
export async function readSandboxMockSetting(): Promise<{
  value: string;
  updatedAt: Date | null;
} | null> {
  if (!isSandboxStack()) return null;
  const [row] = await db
    .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(eq(appSettings.key, SANDBOX_MOCK_SETTING_KEY))
    .limit(1);
  return { value: row?.value ?? "", updatedAt: row?.updatedAt ?? null };
}

/**
 * Store the override ("" = back to normal). Refuses off the sandbox stack
 * and refuses a value it would not understand, so what the panel shows is
 * always what runs.
 */
export async function writeSandboxMockSetting(params: {
  value: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSandboxStack()) {
    return { ok: false, error: "Available on the sandbox only." };
  }
  const value = params.value.trim().toLowerCase();
  if (value && !parseSandboxMockOutcome(value)) {
    return {
      ok: false,
      error: "Use approve, reject, reject:<code>, hold or outage — or leave empty for normal.",
    };
  }
  await db
    .insert(appSettings)
    .values({ key: SANDBOX_MOCK_SETTING_KEY, value, updatedBy: params.userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: params.userId, updatedAt: sql`now()` },
    });
  console.warn(
    `[shaam] sandbox mock outcome set to "${value || "normal"}" by ${params.userId}.`,
  );
  return { ok: true };
}

const HOLD_DAYS = 14;

/** Stamped as the request id of a forced answer; the decision notifier keys on it. */
export const SANDBOX_MOCK_REQUEST_ID = "sandbox-mock";

/** The answer a forced refusal, hold or outage stands in for. */
export function mockShaamResult(
  outcome: Exclude<SandboxMockOutcome, { kind: "approve" }>,
  now: Date = new Date(),
): ShaamSubmitResult {
  const rawResponse = { sandboxMock: true, outcome: outcome.kind };
  switch (outcome.kind) {
    case "reject":
      return {
        result: "REJECTED",
        errorCode: outcome.code,
        errorMessage: `Invoice not approved (sandbox mock, code ${outcome.code})`,
        requestId: SANDBOX_MOCK_REQUEST_ID,
        httpStatus: 200,
        elapsedMs: 0,
        rawResponse: { ...rawResponse, code: outcome.code },
      };
    case "hold":
      return {
        result: "HELD",
        errorCode: "460",
        errorMessage: "Invoice not approved — awaiting a decision (sandbox mock)",
        hearingDeadline: new Date(now.getTime() + HOLD_DAYS * 24 * 60 * 60 * 1000),
        requestId: SANDBOX_MOCK_REQUEST_ID,
        httpStatus: 200,
        elapsedMs: 0,
        rawResponse,
      };
    case "outage":
      return { result: "TIMEOUT", elapsedMs: 0 };
  }
}
