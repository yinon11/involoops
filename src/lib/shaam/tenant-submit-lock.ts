/**
 * Optional per-tenant serialization of the SHAAM clearance path
 * (`submitDocumentToShaam`), gated by `SHAAM_TENANT_SUBMIT_SERIALIZE=1`.
 *
 * Uses a Postgres **session** advisory lock on a key derived from
 * `business_entity_id`. Session locks are visible cluster-wide on the
 * same database, so this coordinates across app replicas and containers.
 *
 * `pg_try_advisory_xact_lock` cannot span the HTTP call to ITA (it
 * releases at transaction end), so we reserve one connection for the
 * duration of the callback via `postgres.begin()`, hold the session lock,
 * run the async work (including outbound HTTP), then unlock in `finally`.
 * While the flag is off by default, enabling it ties up one pool
 * connection per in-flight tenant submit for up to the clearance timeout.
 */

import { postgresClient } from "@/db";

function lockLabel(businessEntityId: string): string {
  return `shaam:submit:tenant:${businessEntityId}`;
}

export function isShaamTenantSubmitSerializeEnabled(): boolean {
  return process.env.SHAAM_TENANT_SUBMIT_SERIALIZE === "1";
}

export type TenantSubmitLockResult<T> =
  | { ok: true; result: T }
  | { ok: false; reason: "busy" };

/**
 * Runs `fn` while holding a try-style session advisory lock for the
 * tenant. If the lock is not acquired immediately, returns `{ ok: false }`
 * without calling `fn`.
 */
export async function withShaamTenantSubmitLock<T>(
  businessEntityId: string,
  fn: () => Promise<T>,
): Promise<TenantSubmitLockResult<T>> {
  const label = lockLabel(businessEntityId);
  return postgresClient.begin(async (sql) => {
    const [row] = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${label})::bigint) AS acquired
    `;
    if (!row?.acquired) {
      return { ok: false as const, reason: "busy" as const };
    }
    try {
      const result = await fn();
      return { ok: true as const, result };
    } finally {
      await sql`
        SELECT pg_advisory_unlock(hashtext(${label})::bigint)
      `;
    }
  });
}
