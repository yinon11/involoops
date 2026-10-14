/**
 * Manual verification harness for Spec 07 SHAAM OAuth client.
 *
 * Run: `npx tsx scripts/verify-shaam-oauth.ts`
 * Requires: DATABASE_URL, SHAAM_TOKEN_ENCRYPTION_SECRET (or
 * AUTH_SECRET). Does NOT touch the real ITA API — the `fetch`-based
 * client is stubbed via `_setShaamFetchForTests`.
 *
 * Scenarios (per spec 07 §Tests):
 *   1. Encryption roundtrip.
 *   2. Tamper detection (flip ciphertext byte → decrypt throws).
 *   3. Full authorization flow with stubbed fetch.
 *   4. Access token reuse (two rapid calls → one refresh call).
 *   5. Refresh on near-expiry.
 *   6. Refresh token rotation.
 *   7. 401 → AUTHORIZATION_EXPIRED.
 *   8. Concurrent refresh race — 5 parallel calls → exactly 1 refresh.
 *   9. Cron scan summary.
 *  10. Revoke flow.
 *
 * Note on raw-client Date parameters (Bug 2 discipline): `drizzle(client,
 * { schema })` mutates `client.options.serializers` for every timestamp
 * oid to an identity function. Raw `client\`…\`` fixtures must pass
 * `date.toISOString()`, not a Date object, or postgres-js's Bind step
 * will hand a Date to `Buffer.byteLength` and throw ERR_INVALID_ARG_TYPE.
 * Current fixtures use `NOW() + INTERVAL` so the pattern doesn't trigger,
 * but preserve the discipline if you add new Date fixtures.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { decryptToken, encryptToken } from "@/lib/shaam/token-crypto";
import { _setShaamFetchForTests, type FetchImpl } from "@/lib/shaam/client";
import {
  completeAuthorization,
  getActiveAccessToken,
  initiateAuthorization,
  revokeAuthorization,
} from "@/lib/shaam/authorization";
import { ShaamAuthorizationError } from "@/lib/shaam/errors";

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

loadEnvFile();

// Supply stub values so getShaamConfig() passes assertShaamConfig.
process.env.SHAAM_CLIENT_ID ||= "stub-client";
process.env.SHAAM_CLIENT_SECRET ||= "stub-secret";
process.env.SHAAM_REDIRECT_URI ||=
  "http://localhost:3000/api/shaam/oauth/callback";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL, { max: 12 });
const db = drizzle(client, { schema });

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

interface Fixture {
  userId: string;
  businessEntityId: string;
}

async function mkFixture(tag: string): Promise<Fixture> {
  const email = `verify-shaam-${tag}-${randomUUID()}@test.local`;
  const [user] = await client<{ id: string }[]>`
    INSERT INTO users (email) VALUES (${email}) RETURNING id
  `;
  const [entity] = await client<{ id: string }[]>`
    INSERT INTO business_entities (owner_user_id, legal_name, entity_type)
    VALUES (${user.id}, ${"verify-" + tag}, 'OSEK_MURSHE')
    RETURNING id
  `;
  return { userId: user.id, businessEntityId: entity.id };
}

async function cleanup(f: Fixture) {
  await client`DELETE FROM shaam_token_events WHERE business_entity_id = ${f.businessEntityId}`;
  await client`DELETE FROM shaam_authorization_pending WHERE business_entity_id = ${f.businessEntityId}`;
  await client`DELETE FROM shaam_authorizations WHERE business_entity_id = ${f.businessEntityId}`;
  await client`DELETE FROM business_entities WHERE id = ${f.businessEntityId}`;
  await client`DELETE FROM users WHERE id = ${f.userId}`;
}

function stubFetch(
  responses: Array<{
    status?: number;
    body: Record<string, unknown>;
  }>,
): { fetchImpl: FetchImpl; calls: () => number } {
  let i = 0;
  const fetchImpl: FetchImpl = async () => {
    const next = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls: () => i };
}

// --- 1. crypto roundtrip ---------------------------------------------------

function scenarioCryptoRoundtrip() {
  const name = "1. crypto — encrypt/decrypt roundtrip";
  const sample = "refresh-token-abc.xyz";
  const enc = encryptToken(sample);
  const dec = decryptToken(enc);
  record(name, dec === sample, dec === sample ? "ok" : "mismatch");
}

// --- 2. tamper detection ---------------------------------------------------

function scenarioCryptoTamper() {
  const name = "2. crypto — tampered ciphertext throws";
  const enc = encryptToken("tamper-me");
  const bytes = Buffer.from(enc.ciphertext, "base64");
  bytes[0] ^= 0x01;
  const tampered = { ...enc, ciphertext: bytes.toString("base64") };
  let threw = false;
  try {
    decryptToken(tampered);
  } catch {
    threw = true;
  }
  record(name, threw, threw ? "threw as expected" : "unexpectedly decrypted");
}

// --- 3. full authorization flow --------------------------------------------

async function scenarioAuthorize() {
  const name = "3. authorize flow — end-to-end via stubbed fetch";
  const f = await mkFixture("auth");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          token_type: "Bearer",
          expires_in: 1800,
          scope: "invoice-allocation",
        },
      },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      const result = await completeAuthorization({
        state,
        code: "auth-code-xyz",
        environment: "UAT",
      });
      const [row] = await client<{
        status: string;
        access_token_encrypted: string | null;
      }[]>`
        SELECT status, access_token_encrypted FROM shaam_authorizations
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      record(
        name,
        result.status === "ACTIVE" &&
          row.status === "ACTIVE" &&
          Boolean(row.access_token_encrypted),
        `status=${row.status} encrypted=${Boolean(row.access_token_encrypted)}`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

// --- 4. access token reuse -------------------------------------------------

async function scenarioAccessTokenReuse() {
  const name = "4. access token reuse — second call skips refresh";
  const f = await mkFixture("reuse");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-reuse",
          refresh_token: "refresh-reuse",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      await completeAuthorization({ state, code: "c", environment: "UAT" });
      const t1 = await getActiveAccessToken({
        businessEntityId: f.businessEntityId,
        environment: "UAT",
      });
      const t2 = await getActiveAccessToken({
        businessEntityId: f.businessEntityId,
        environment: "UAT",
      });
      // Expect 1 network call (authorization code exchange). Both
      // subsequent calls should return the cached access token.
      record(
        name,
        t1 === "access-reuse" && t2 === "access-reuse" && stub.calls() === 1,
        `t1=${t1.slice(0, 6)} t2=${t2.slice(0, 6)} calls=${stub.calls()}`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

// --- 5. refresh on near-expiry --------------------------------------------

async function scenarioRefreshOnNearExpiry() {
  const name = "5. refresh on near-expiry — leeway triggers refresh";
  const f = await mkFixture("near");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-v1",
          refresh_token: "refresh-v1",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
      {
        body: {
          access_token: "access-v2",
          refresh_token: "refresh-v1",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      await completeAuthorization({ state, code: "c", environment: "UAT" });
      // Push access-token expiry inside the leeway window.
      await client`
        UPDATE shaam_authorizations
        SET access_token_expires_at = NOW() + INTERVAL '2 minutes'
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      const t = await getActiveAccessToken({
        businessEntityId: f.businessEntityId,
        environment: "UAT",
      });
      record(
        name,
        t === "access-v2" && stub.calls() === 2,
        `token=${t} calls=${stub.calls()}`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

// --- 6. refresh token rotation --------------------------------------------

async function scenarioRefreshRotation() {
  const name = "6. refresh rotation — new refresh_token persisted";
  const f = await mkFixture("rotate");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-a",
          refresh_token: "refresh-a",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
      {
        body: {
          access_token: "access-b",
          refresh_token: "refresh-b",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      await completeAuthorization({ state, code: "c", environment: "UAT" });
      await client`
        UPDATE shaam_authorizations
        SET access_token_expires_at = NOW() - INTERVAL '1 minute'
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      await getActiveAccessToken({
        businessEntityId: f.businessEntityId,
        environment: "UAT",
      });
      const [row] = await client<{
        refresh_token_encrypted: string;
        refresh_token_iv: string;
        refresh_token_tag: string;
      }[]>`
        SELECT refresh_token_encrypted, refresh_token_iv, refresh_token_tag
        FROM shaam_authorizations
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      const current = decryptToken({
        ciphertext: row.refresh_token_encrypted,
        iv: row.refresh_token_iv,
        tag: row.refresh_token_tag,
      });
      record(
        name,
        current === "refresh-b",
        `stored=${current}`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

// --- 7. 401 → expired -----------------------------------------------------

async function scenarioExpiredOn401() {
  const name = "7. 401 on refresh → status EXPIRED + typed error";
  const f = await mkFixture("expired");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-ok",
          refresh_token: "refresh-ok",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
      { status: 401, body: { error: "invalid_grant" } },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      await completeAuthorization({ state, code: "c", environment: "UAT" });
      await client`
        UPDATE shaam_authorizations
        SET access_token_expires_at = NOW() - INTERVAL '1 minute'
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      let threwReason: string | undefined;
      try {
        await getActiveAccessToken({
          businessEntityId: f.businessEntityId,
          environment: "UAT",
        });
      } catch (err) {
        if (err instanceof ShaamAuthorizationError) threwReason = err.reason;
      }
      const [row] = await client<{ status: string }[]>`
        SELECT status FROM shaam_authorizations
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      record(
        name,
        threwReason === "expired" && row.status === "EXPIRED",
        `reason=${threwReason} status=${row.status}`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

// --- 8. concurrent refresh ------------------------------------------------

async function scenarioConcurrentRefresh() {
  const name = "8. concurrent refresh — FOR UPDATE collapses to 1 call";
  const f = await mkFixture("conc");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-seed",
          refresh_token: "refresh-seed",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
      {
        body: {
          access_token: "access-refreshed",
          refresh_token: "refresh-seed",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      await completeAuthorization({ state, code: "c", environment: "UAT" });
      await client`
        UPDATE shaam_authorizations
        SET access_token_expires_at = NOW() - INTERVAL '1 minute'
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      const before = stub.calls();
      await Promise.all(
        Array.from({ length: 5 }, () =>
          getActiveAccessToken({
            businessEntityId: f.businessEntityId,
            environment: "UAT",
          }),
        ),
      );
      const after = stub.calls();
      // Expect: exactly 1 refresh call (the race-winner), not 5.
      record(
        name,
        after - before === 1,
        `refresh calls during race=${after - before}`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

// --- 9. revoke flow --------------------------------------------------------

async function scenarioRevoke() {
  const name = "9. revoke — DB flips to REVOKED, tokens cleared";
  const f = await mkFixture("revoke");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-rev",
          refresh_token: "refresh-rev",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
      { body: {} },
      { body: {} },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      await completeAuthorization({ state, code: "c", environment: "UAT" });
      await revokeAuthorization({
        businessEntityId: f.businessEntityId,
        actorUserId: f.userId,
        environment: "UAT",
      });
      const [row] = await client<{
        status: string;
        access_token_encrypted: string | null;
        refresh_token_encrypted: string | null;
      }[]>`
        SELECT status, access_token_encrypted, refresh_token_encrypted
        FROM shaam_authorizations
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      record(
        name,
        row.status === "REVOKED" &&
          row.access_token_encrypted === null &&
          row.refresh_token_encrypted === null,
        `status=${row.status} tokens_cleared=${row.access_token_encrypted === null && row.refresh_token_encrypted === null}`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

// --- 10. events logged ----------------------------------------------------

async function scenarioEventsLogged() {
  const name = "10. events — AUTHORIZATION_GRANTED + refresh events recorded";
  const f = await mkFixture("events");
  try {
    const { state } = await initiateAuthorization({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
      environment: "UAT",
    });
    const stub = stubFetch([
      {
        body: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
      {
        body: {
          access_token: "access-2",
          refresh_token: "refresh-2",
          token_type: "Bearer",
          expires_in: 1800,
        },
      },
    ]);
    _setShaamFetchForTests(stub.fetchImpl);
    try {
      await completeAuthorization({ state, code: "c", environment: "UAT" });
      await client`
        UPDATE shaam_authorizations
        SET access_token_expires_at = NOW() - INTERVAL '1 minute'
        WHERE business_entity_id = ${f.businessEntityId} AND environment = 'UAT'
      `;
      await getActiveAccessToken({
        businessEntityId: f.businessEntityId,
        environment: "UAT",
      });
      const events = await client<{ event_type: string }[]>`
        SELECT event_type FROM shaam_token_events
        WHERE business_entity_id = ${f.businessEntityId}
        ORDER BY created_at ASC
      `;
      const types = events.map((e) => e.event_type);
      record(
        name,
        types.includes("AUTHORIZATION_GRANTED") &&
          types.includes("ACCESS_TOKEN_REFRESHED") &&
          types.includes("REFRESH_TOKEN_ROTATED"),
        `events=[${types.join(",")}]`,
      );
    } finally {
      _setShaamFetchForTests(undefined);
    }
  } finally {
    await cleanup(f);
  }
}

async function main() {
  await db.execute(dsql`SELECT 1`);
  console.log("[verify-shaam-oauth] starting…\n");
  const scenarios: Array<[string, () => Promise<void> | void]> = [
    ["cryptoRoundtrip", scenarioCryptoRoundtrip],
    ["cryptoTamper", scenarioCryptoTamper],
    ["authorize", scenarioAuthorize],
    ["accessTokenReuse", scenarioAccessTokenReuse],
    ["refreshOnNearExpiry", scenarioRefreshOnNearExpiry],
    ["refreshRotation", scenarioRefreshRotation],
    ["expiredOn401", scenarioExpiredOn401],
    ["concurrentRefresh", scenarioConcurrentRefresh],
    ["revoke", scenarioRevoke],
    ["eventsLogged", scenarioEventsLogged],
  ];
  for (const [label, fn] of scenarios) {
    try {
      await fn();
    } catch (err) {
      record(label, false, err instanceof Error ? err.message : String(err));
    }
  }
  await client.end({ timeout: 10 });
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n[verify-shaam-oauth] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-shaam-oauth] fatal:", err);
  process.exit(1);
});
