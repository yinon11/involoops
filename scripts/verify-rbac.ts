/**
 * Manual verification harness for Spec 03 RBAC.
 *
 * Run: `npx tsx scripts/verify-rbac.ts`
 * Requires: DATABASE_URL with migrations 0022 + 0023 + 0024 applied.
 *
 * Scenarios:
 *   1. Admin short-circuit — isAdmin user without membership → allowed.
 *   2. Non-member denial — non-admin, no membership → not_a_member.
 *   3. Owner permissions — non-admin OWNER → all allowed.
 *   4. Partial permissions — non-admin VIEWER → view yes, draft no.
 *   5. Denial logging — denial writes a rbac_denials row.
 *   6. Business entity context — getBusinessEntityForUser returns owner row.
 *   7. Cross-tenant — user B operating on business A's entity id is denied.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { authorize } from "@/lib/rbac/authorize";
import { PERMISSIONS, ROLE_PRESETS } from "@/lib/rbac/permissions";
import { getBusinessEntityForUser } from "@/lib/rbac/current-business-entity";

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

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

interface UserFixture {
  userId: string;
  email: string;
}

interface EntityFixture extends UserFixture {
  businessEntityId: string;
}

async function mkUser(tag: string, isAdmin = false): Promise<UserFixture> {
  const email = `verify-rbac-${tag}-${randomUUID()}@test.local`;
  const [row] = await client<{ id: string }[]>`
    INSERT INTO users (email, is_admin) VALUES (${email}, ${isAdmin}) RETURNING id
  `;
  return { userId: row.id, email };
}

async function mkEntityForUser(
  tag: string,
  userId: string,
): Promise<EntityFixture> {
  const [entity] = await client<{ id: string }[]>`
    INSERT INTO business_entities (owner_user_id, legal_name, entity_type)
    VALUES (${userId}, ${"verify-" + tag}, 'OSEK_MURSHE')
    RETURNING id
  `;
  return { userId, email: tag, businessEntityId: entity.id };
}

async function grantMembership(
  businessEntityId: string,
  userId: string,
  role: keyof typeof ROLE_PRESETS,
) {
  const permissions = JSON.stringify(ROLE_PRESETS[role]);
  await client`
    INSERT INTO business_entity_members
      (business_entity_id, user_id, role, permissions)
    VALUES (${businessEntityId}, ${userId}, ${role}, ${permissions}::jsonb)
    ON CONFLICT (business_entity_id, user_id) DO NOTHING
  `;
}

async function cleanupUsers(ids: string[]) {
  if (ids.length === 0) return;
  await client`DELETE FROM rbac_denials WHERE user_id = ANY(${ids}::uuid[])`;
  await client`DELETE FROM business_entity_members WHERE user_id = ANY(${ids}::uuid[])`;
  await client`DELETE FROM business_entities WHERE owner_user_id = ANY(${ids}::uuid[])`;
  await client`DELETE FROM users WHERE id = ANY(${ids}::uuid[])`;
}

// --- Scenario 1: admin short-circuit ---------------------------------------

async function scenarioAdminShortCircuit() {
  const name = "1. admin short-circuit — admin with no membership → allowed";
  const admin = await mkUser("admin", true);
  const ownerFix = await mkUser("owner1");
  const owner = await mkEntityForUser("owner1", ownerFix.userId);
  try {
    const res = await authorize({
      userId: admin.userId,
      businessEntityId: owner.businessEntityId,
      permission: PERMISSIONS.DOCUMENT_VIEW,
      route: "verify:admin",
    });
    record(name, res.allowed === true, `allowed=${res.allowed}`);
  } finally {
    await cleanupUsers([admin.userId, ownerFix.userId]);
  }
}

// --- Scenario 2: non-member denial -----------------------------------------

async function scenarioNotMember() {
  const name = "2. non-member denial — returns not_a_member + logs";
  const stranger = await mkUser("stranger");
  const ownerFix = await mkUser("owner2");
  const owner = await mkEntityForUser("owner2", ownerFix.userId);
  try {
    const res = await authorize({
      userId: stranger.userId,
      businessEntityId: owner.businessEntityId,
      permission: PERMISSIONS.DOCUMENT_VIEW,
      route: "verify:stranger",
    });
    record(
      name,
      res.allowed === false && res.reason === "not_a_member",
      `allowed=${res.allowed} reason=${res.allowed === false ? res.reason : "-"}`,
    );
  } finally {
    await cleanupUsers([stranger.userId, ownerFix.userId]);
  }
}

// --- Scenario 3: owner permissions -----------------------------------------

async function scenarioOwnerPermissions() {
  const name = "3. owner role — every permission is allowed";
  const ownerFix = await mkUser("ownerAll");
  const owner = await mkEntityForUser("ownerAll", ownerFix.userId);
  await grantMembership(owner.businessEntityId, owner.userId, "OWNER");
  try {
    const all = Object.values(PERMISSIONS);
    const checks = await Promise.all(
      all.map((p) =>
        authorize({
          userId: owner.userId,
          businessEntityId: owner.businessEntityId,
          permission: p,
        }),
      ),
    );
    const allowedCount = checks.filter((c) => c.allowed).length;
    record(name, allowedCount === all.length, `${allowedCount}/${all.length} allowed`);
  } finally {
    await cleanupUsers([ownerFix.userId]);
  }
}

// --- Scenario 4: partial permissions ---------------------------------------

async function scenarioPartial() {
  const name =
    "4. viewer role — DOCUMENT_VIEW allowed, DOCUMENT_CREATE_DRAFT denied";
  const ownerFix = await mkUser("ownerV");
  const viewer = await mkUser("viewer");
  const owner = await mkEntityForUser("ownerV", ownerFix.userId);
  await grantMembership(owner.businessEntityId, viewer.userId, "VIEWER");
  try {
    const viewResult = await authorize({
      userId: viewer.userId,
      businessEntityId: owner.businessEntityId,
      permission: PERMISSIONS.DOCUMENT_VIEW,
    });
    const createResult = await authorize({
      userId: viewer.userId,
      businessEntityId: owner.businessEntityId,
      permission: PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    });
    const ok =
      viewResult.allowed === true &&
      createResult.allowed === false &&
      createResult.reason === "permission_not_granted";
    record(
      name,
      ok,
      `view=${viewResult.allowed} create=${createResult.allowed}`,
    );
  } finally {
    await cleanupUsers([ownerFix.userId, viewer.userId]);
  }
}

// --- Scenario 5: denial logging --------------------------------------------

async function scenarioDenialLogging() {
  const name = "5. denial logging — denial inserts rbac_denials row";
  const stranger = await mkUser("denial");
  const ownerFix = await mkUser("ownerD");
  const owner = await mkEntityForUser("ownerD", ownerFix.userId);
  try {
    await authorize({
      userId: stranger.userId,
      businessEntityId: owner.businessEntityId,
      permission: PERMISSIONS.DOCUMENT_VIEW,
      route: "verify:denial",
    });
    const [row] = await client<{ count: string | number }[]>`
      SELECT COUNT(*)::int AS count FROM rbac_denials
      WHERE user_id = ${stranger.userId}
        AND business_entity_id = ${owner.businessEntityId}
    `;
    const count = Number(row.count);
    record(name, count === 1, `rows=${count}`);
  } finally {
    await cleanupUsers([stranger.userId, ownerFix.userId]);
  }
}

// --- Scenario 6: business entity context -----------------------------------

async function scenarioEntityContext() {
  const name = "6. getBusinessEntityForUser — returns the owned entity";
  const ownerFix = await mkUser("ctx");
  const owner = await mkEntityForUser("ctx", ownerFix.userId);
  try {
    const entity = await getBusinessEntityForUser(owner.userId);
    record(
      name,
      entity.id === owner.businessEntityId,
      `entityId=${entity.id}`,
    );
  } finally {
    await cleanupUsers([ownerFix.userId]);
  }
}

// --- Scenario 7: cross-tenant ----------------------------------------------

async function scenarioCrossTenant() {
  const name =
    "7. cross-tenant — user B operating on business A is denied (not_a_member)";
  const ownerAFix = await mkUser("xA");
  const ownerBFix = await mkUser("xB");
  const ownerA = await mkEntityForUser("xA", ownerAFix.userId);
  const ownerB = await mkEntityForUser("xB", ownerBFix.userId);
  await grantMembership(ownerA.businessEntityId, ownerA.userId, "OWNER");
  await grantMembership(ownerB.businessEntityId, ownerB.userId, "OWNER");
  try {
    const crossResult = await authorize({
      userId: ownerB.userId,
      businessEntityId: ownerA.businessEntityId,
      permission: PERMISSIONS.DOCUMENT_VIEW,
    });
    record(
      name,
      crossResult.allowed === false && crossResult.reason === "not_a_member",
      `allowed=${crossResult.allowed} reason=${crossResult.allowed === false ? crossResult.reason : "-"}`,
    );
  } finally {
    await cleanupUsers([ownerAFix.userId, ownerBFix.userId]);
  }
}

async function main() {
  console.log("[verify-rbac] starting…\n");
  const scenarios: Array<[string, () => Promise<void>]> = [
    ["adminShortCircuit", scenarioAdminShortCircuit],
    ["notMember", scenarioNotMember],
    ["ownerPermissions", scenarioOwnerPermissions],
    ["partial", scenarioPartial],
    ["denialLogging", scenarioDenialLogging],
    ["entityContext", scenarioEntityContext],
    ["crossTenant", scenarioCrossTenant],
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
  console.log(`\n[verify-rbac] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-rbac] fatal:", err);
  process.exit(1);
});
