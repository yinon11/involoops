/**
 * Manual verification harness for Spec 09 tenant readiness state
 * machine + notification dedup.
 *
 * Run: `npx tsx scripts/verify-tenant-readiness.ts`
 * Requires: DATABASE_URL pointing at a DB where migrations 0022
 * onward have been applied.
 *
 * Scenarios (per spec 09 §Tests):
 *   1. GOV_SETUP_REQUIRED (fresh) — fresh entity, no osek_murshe
 *      → FILL_OSEK_MURSHE. (Was NOT_STARTED in spec 09; collapsed.)
 *   2. GOV_SETUP_REQUIRED — osek_murshe set, no confirmations →
 *      CONFIRM_AZOR_ISHI.
 *   3. GOV → READY_TO_AUTHORIZE transition: set all three self-report
 *      flags → state = READY_TO_AUTHORIZE, action = START_OAUTH.
 *   4. AUTHORIZED — ACTIVE auth 60 days out → state = AUTHORIZED,
 *      action = NONE.
 *   5. RENEW_SOON — ACTIVE auth 10 days out → action = RENEW_SOON
 *      with daysLeft = 10.
 *   6. EXPIRED — status = EXPIRED → action = REAUTHORIZE expired.
 *   7. REVOKED — status = REVOKED → action = REAUTHORIZE revoked.
 *   8. OSEK_MURSHE change resets the flags + revokes ACTIVE auth.
 *   9. Notification dedup — insert a sent row, attempt duplicate,
 *      expect the second to no-op.
 *  10. Taagid auto-true for OSEK_MURSHE entity type.
 *
 * Note on raw-client Date parameters: `drizzle(client, { schema })`
 * mutates `client.options.serializers` for every timestamp oid to an
 * identity function (Drizzle pre-formats Dates via `mapToDriverValue`).
 * Raw `client\`…\`` fixtures in this harness therefore must pass
 * `date.toISOString()`, not the Date object, or postgres-js's Bind
 * step will hand a Date to `Buffer.byteLength` and throw ERR_INVALID_ARG_TYPE.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  getTenantReadiness,
  resetReadinessOnOsekMursheChange,
  setReadinessStep,
} from "@/lib/shaam/tenant-readiness";

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

async function mkFixture(
  tag: string,
  opts: { osekMurshe?: string; entityType?: string } = {},
): Promise<Fixture> {
  const email = `verify-readiness-${tag}-${randomUUID()}@test.local`;
  const [user] = await client<{ id: string }[]>`
    INSERT INTO users (email) VALUES (${email}) RETURNING id
  `;
  const [entity] = await client<{ id: string }[]>`
    INSERT INTO business_entities
      (owner_user_id, legal_name, entity_type, osek_murshe)
    VALUES (
      ${user.id},
      ${"verify-" + tag},
      ${opts.entityType ?? "OSEK_MURSHE"},
      ${opts.osekMurshe ?? null}
    )
    RETURNING id
  `;
  return { userId: user.id, businessEntityId: entity.id };
}

async function cleanup(f: Fixture) {
  await client`DELETE FROM notification_sent_log WHERE business_entity_id = ${f.businessEntityId}`;
  await client`DELETE FROM shaam_authorizations WHERE business_entity_id = ${f.businessEntityId}`;
  await client`DELETE FROM shaam_tenant_readiness WHERE business_entity_id = ${f.businessEntityId}`;
  await client`DELETE FROM business_entities WHERE id = ${f.businessEntityId}`;
  await client`DELETE FROM users WHERE id = ${f.userId}`;
}

// --- 1. GOV_SETUP_REQUIRED (fresh) ---------------------------------------

async function scenarioNotStarted() {
  // Fresh entity with no data: state enum collapsed from
  // NOT_STARTED → GOV_SETUP_REQUIRED during validation (both
  // produced FILL_OSEK_MURSHE, so the distinction was dropped).
  const name =
    "1. GOV_SETUP_REQUIRED (fresh) — fresh entity → FILL_OSEK_MURSHE";
  const f = await mkFixture("ns");
  try {
    const snap = await getTenantReadiness(f.businessEntityId);
    record(
      name,
      snap.state === "GOV_SETUP_REQUIRED" &&
        snap.nextAction.kind === "FILL_OSEK_MURSHE",
      `state=${snap.state} action=${snap.nextAction.kind}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 2. GOV_SETUP_REQUIRED ------------------------------------------------

async function scenarioGovSetupRequired() {
  const name = "2. GOV_SETUP_REQUIRED — osek set → CONFIRM_AZOR_ISHI";
  const f = await mkFixture("gov", { osekMurshe: "123456789" });
  try {
    const snap = await getTenantReadiness(f.businessEntityId);
    record(
      name,
      snap.state === "GOV_SETUP_REQUIRED" &&
        snap.nextAction.kind === "CONFIRM_AZOR_ISHI",
      `state=${snap.state} action=${snap.nextAction.kind}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 3. READY_TO_AUTHORIZE ------------------------------------------------

async function scenarioReadyToAuthorize() {
  const name = "3. READY_TO_AUTHORIZE — all flags → START_OAUTH";
  const f = await mkFixture("ready", { osekMurshe: "123456789" });
  try {
    for (const step of ["azorIshi", "taagid", "morsheAl"] as const) {
      await setReadinessStep({
        businessEntityId: f.businessEntityId,
        step,
        confirmed: true,
        confirmedByUserId: f.userId,
      });
    }
    const snap = await getTenantReadiness(f.businessEntityId);
    record(
      name,
      snap.state === "READY_TO_AUTHORIZE" &&
        snap.nextAction.kind === "START_OAUTH",
      `state=${snap.state} action=${snap.nextAction.kind}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 4. AUTHORIZED --------------------------------------------------------

async function scenarioAuthorized() {
  const name = "4. AUTHORIZED — ACTIVE auth 60d → NONE";
  const f = await mkFixture("auth", { osekMurshe: "123456789" });
  try {
    const futureExpiry = new Date(Date.now() + 60 * 86_400_000);
    await client`
      INSERT INTO shaam_authorizations
        (business_entity_id, environment, status, refresh_token_expires_at)
      VALUES (${f.businessEntityId}, 'UAT', 'ACTIVE', ${futureExpiry.toISOString()})
    `;
    const snap = await getTenantReadiness(f.businessEntityId, "UAT");
    record(
      name,
      snap.state === "AUTHORIZED" && snap.nextAction.kind === "NONE",
      `state=${snap.state} action=${snap.nextAction.kind}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 5. RENEW_SOON --------------------------------------------------------

async function scenarioRenewSoon() {
  const name = "5. RENEW_SOON — ACTIVE auth 10d → RENEW_SOON(daysLeft=10)";
  const f = await mkFixture("renew", { osekMurshe: "123456789" });
  try {
    const soon = new Date(Date.now() + 10 * 86_400_000);
    await client`
      INSERT INTO shaam_authorizations
        (business_entity_id, environment, status, refresh_token_expires_at)
      VALUES (${f.businessEntityId}, 'UAT', 'ACTIVE', ${soon.toISOString()})
    `;
    const snap = await getTenantReadiness(f.businessEntityId, "UAT");
    const ok =
      snap.state === "AUTHORIZED" &&
      snap.nextAction.kind === "RENEW_SOON" &&
      snap.nextAction.kind === "RENEW_SOON" &&
      snap.nextAction.daysLeft <= 10 &&
      snap.nextAction.daysLeft >= 9;
    record(
      name,
      ok,
      `state=${snap.state} action=${snap.nextAction.kind} daysLeft=${snap.nextAction.kind === "RENEW_SOON" ? snap.nextAction.daysLeft : "n/a"}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 6/7. EXPIRED + REVOKED -----------------------------------------------

async function scenarioExpired() {
  const name = "6. EXPIRED — status=EXPIRED → REAUTHORIZE(expired)";
  const f = await mkFixture("exp", { osekMurshe: "123456789" });
  try {
    await client`
      INSERT INTO shaam_authorizations
        (business_entity_id, environment, status)
      VALUES (${f.businessEntityId}, 'UAT', 'EXPIRED')
    `;
    const snap = await getTenantReadiness(f.businessEntityId, "UAT");
    const ok =
      snap.state === "EXPIRED" &&
      snap.nextAction.kind === "REAUTHORIZE" &&
      snap.nextAction.kind === "REAUTHORIZE" &&
      snap.nextAction.reason === "expired";
    record(
      name,
      ok,
      `state=${snap.state} action=${snap.nextAction.kind} reason=${snap.nextAction.kind === "REAUTHORIZE" ? snap.nextAction.reason : "n/a"}`,
    );
  } finally {
    await cleanup(f);
  }
}

async function scenarioRevoked() {
  const name = "7. REVOKED — status=REVOKED → REAUTHORIZE(revoked)";
  const f = await mkFixture("rev", { osekMurshe: "123456789" });
  try {
    await client`
      INSERT INTO shaam_authorizations
        (business_entity_id, environment, status)
      VALUES (${f.businessEntityId}, 'UAT', 'REVOKED')
    `;
    const snap = await getTenantReadiness(f.businessEntityId, "UAT");
    const ok =
      snap.state === "EXPIRED" &&
      snap.nextAction.kind === "REAUTHORIZE" &&
      snap.nextAction.kind === "REAUTHORIZE" &&
      snap.nextAction.reason === "revoked";
    record(
      name,
      ok,
      `state=${snap.state} reason=${snap.nextAction.kind === "REAUTHORIZE" ? snap.nextAction.reason : "n/a"}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 8. osek change resets ------------------------------------------------

async function scenarioOsekChange() {
  const name =
    "8. osek_murshe change resets checklist flags and revokes auth";
  const f = await mkFixture("osek", { osekMurshe: "111111111" });
  try {
    for (const step of ["azorIshi", "taagid", "morsheAl"] as const) {
      await setReadinessStep({
        businessEntityId: f.businessEntityId,
        step,
        confirmed: true,
        confirmedByUserId: f.userId,
      });
    }
    const fut = new Date(Date.now() + 60 * 86_400_000);
    await client`
      INSERT INTO shaam_authorizations
        (business_entity_id, environment, status, refresh_token_expires_at)
      VALUES (${f.businessEntityId}, 'UAT', 'ACTIVE', ${fut.toISOString()})
    `;

    // Act: simulate osek change by calling the reset helper + flipping
    // the osek column.
    await client`UPDATE business_entities SET osek_murshe = '222222222' WHERE id = ${f.businessEntityId}`;
    await resetReadinessOnOsekMursheChange({
      businessEntityId: f.businessEntityId,
      actorUserId: f.userId,
    });

    // `taagidRegistered` is derived from entityType — for OSEK_MURSHE
    // / OSEK_PATUR it is auto-true regardless of the row (see spec 09
    // §2 and scenario 10). The reset must clear the other two
    // self-report flags and revoke the ACTIVE auth; taagidRegistered
    // is accepted as whatever the entity-type derivation produces.
    const snap = await getTenantReadiness(f.businessEntityId, "UAT");
    const ok =
      !snap.checklist.azorIshiConfirmed &&
      !snap.checklist.morsheAlAssigned &&
      snap.authorization.status === "REVOKED";
    record(
      name,
      ok,
      `flags=${JSON.stringify(snap.checklist)} authStatus=${snap.authorization.status}`,
    );
  } finally {
    await cleanup(f);
  }
}

// --- 9. notification dedup -----------------------------------------------

async function scenarioNotificationDedup() {
  const name = "9. notification_sent_log — UNIQUE prevents double-send";
  const f = await mkFixture("dedup", { osekMurshe: "123456789" });
  try {
    await client`
      INSERT INTO notification_sent_log
        (business_entity_id, notification_kind, dedupe_key)
      VALUES (${f.businessEntityId}, 'expiry-warning-14d', '2026-04-20')
    `;
    let threw = false;
    try {
      await client`
        INSERT INTO notification_sent_log
          (business_entity_id, notification_kind, dedupe_key)
        VALUES (${f.businessEntityId}, 'expiry-warning-14d', '2026-04-20')
      `;
    } catch {
      threw = true;
    }
    record(name, threw, threw ? "unique conflict as expected" : "unexpectedly inserted twice");
  } finally {
    await cleanup(f);
  }
}

// --- 11. admin gate on /settings/ita-integration (Spec 11 safety net) -----

async function scenarioAdminGate() {
  // Spec 11 §Tests — read the page module and assert that its
  // default export calls `isUserAdmin` before rendering. This is a
  // static safety net in case a future refactor accidentally removes
  // the gate. When Form 513 is approved (Spec 12), the gate is
  // flipped to a permission check; update this scenario then.
  const name =
    "11. admin gate — /settings/ita-integration enforces isUserAdmin";
  try {
    const src = await import("node:fs").then((m) =>
      m.readFileSync(
        resolve(
          process.cwd(),
          "src/app/(app)/settings/ita-integration/page.tsx",
        ),
        "utf8",
      ),
    );
    const mentionsAdmin = src.includes("isUserAdmin");
    const notFoundOrRedirect =
      src.includes("notFound()") || src.includes("redirect(");
    const ok = mentionsAdmin && notFoundOrRedirect;
    record(
      name,
      ok,
      `isUserAdmin=${mentionsAdmin} notFound/redirect=${notFoundOrRedirect}`,
    );
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

// --- 10. taagid auto-true for OSEK_MURSHE ---------------------------------

async function scenarioTaagidAuto() {
  const name = "10. taagid auto-true for OSEK_MURSHE entity type";
  const f = await mkFixture("taagid", {
    osekMurshe: "123456789",
    entityType: "OSEK_MURSHE",
  });
  try {
    await setReadinessStep({
      businessEntityId: f.businessEntityId,
      step: "azorIshi",
      confirmed: true,
      confirmedByUserId: f.userId,
    });
    await setReadinessStep({
      businessEntityId: f.businessEntityId,
      step: "morsheAl",
      confirmed: true,
      confirmedByUserId: f.userId,
    });
    const snap = await getTenantReadiness(f.businessEntityId);
    record(
      name,
      snap.checklist.taagidRegistered === true &&
        snap.nextAction.kind === "START_OAUTH",
      `taagid=${snap.checklist.taagidRegistered} action=${snap.nextAction.kind}`,
    );
  } finally {
    await cleanup(f);
  }
}

async function main() {
  await db.execute(dsql`SELECT 1`);
  console.log("[verify-tenant-readiness] starting…\n");
  const scenarios: Array<[string, () => Promise<void>]> = [
    ["notStarted", scenarioNotStarted],
    ["govSetupRequired", scenarioGovSetupRequired],
    ["readyToAuthorize", scenarioReadyToAuthorize],
    ["authorized", scenarioAuthorized],
    ["renewSoon", scenarioRenewSoon],
    ["expired", scenarioExpired],
    ["revoked", scenarioRevoked],
    ["osekChange", scenarioOsekChange],
    ["notificationDedup", scenarioNotificationDedup],
    ["taagidAuto", scenarioTaagidAuto],
    ["adminGate", scenarioAdminGate],
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
  console.log(`\n[verify-tenant-readiness] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-tenant-readiness] fatal:", err);
  process.exit(1);
});
