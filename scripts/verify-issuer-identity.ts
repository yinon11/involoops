/**
 * Integrity harness for issuer-identity rendering (Bug "issuer on PDFs").
 *
 * Scenarios:
 *   1. Helper purity — `buildIssuerIdentityFromEntity` returns the
 *      entity's legalName/osekMurshe; formats multi-line address.
 *   2. Canonical-source — `buildIssuerIdentityFromCanonical` returns
 *      the canonical JSON's business entity, regardless of what the
 *      live DB entity says.
 *   3. Draft render — after creating a live entity + loading through
 *      the helper, the rendered HTML contains the issuer's legalName
 *      and osekMurshe. The template carries no identity columns.
 *   4. Issued render — after storing a signature row with a canonical
 *      JSON, rendering through the canonical-source helper produces
 *      HTML containing the canonical legalName.
 *   5. Integrity regression — mutate the live business_entity's
 *      legalName directly. Re-render through the canonical-source
 *      helper; assert the HTML still contains the ORIGINAL signed
 *      name, not the mutated one.
 *
 * Run: `DATABASE_URL=... npx tsx scripts/verify-issuer-identity.ts`
 *
 * Raw-client Date parameters are converted to ISO strings (see
 * verify-tenant-readiness.ts header for the rationale).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import {
  buildIssuerIdentityFromCanonical,
  buildIssuerIdentityFromEntity,
} from "@/lib/documents/issuer-identity";
import type { CanonicalDocument } from "@/lib/signing/canonical-document";
import { renderInvoiceHtml } from "@/lib/pdf/render-invoice-html";
import type { InvoiceData, TemplateConfig } from "@/types/template";

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

const client = postgres(process.env.DATABASE_URL, { max: 6 });

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
  invoiceId: string;
}

const ORIGINAL_LEGAL_NAME = "InvoLoops Test Issuer Ltd";
const ORIGINAL_OSEK = "517193777";
const MUTATED_LEGAL_NAME = "Mutated Corp — DO NOT TRUST";

/**
 * Resolve the ACTIVE signing_keys row the production signer uses, so
 * fixture inserts into document_signatures satisfy the key_id FK. The
 * dev bootstrap (scripts/generate-dev-signing-key.ts) seeds exactly
 * one ACTIVE row — fabricating a second key_id here would drift from
 * production behaviour and trip the FK.
 */
async function resolveActiveSigningKeyId(): Promise<string | null> {
  const rows = await client<{ key_id: string }[]>`
    SELECT key_id FROM signing_keys WHERE status = 'ACTIVE' LIMIT 1
  `;
  return rows[0]?.key_id ?? null;
}

function makeCanonical(invoiceId: string, entityId: string): CanonicalDocument {
  return {
    schemaVersion: 1,
    documentId: invoiceId,
    documentType: "TAX_INVOICE",
    formattedNumber: "2026-TI-999001",
    sequenceNumber: 999001,
    taxYear: 2026,
    issueDate: "2026-04-20T00:00:00.000Z",
    businessEntity: {
      id: entityId,
      legalName: ORIGINAL_LEGAL_NAME,
      osekMurshe: ORIGINAL_OSEK,
      entityType: "OSEK_MURSHE",
      address: { street: "Rothschild 1", city: "Tel Aviv", zip: "6122001", country: "IL" },
    },
    customer: { id: null, name: "Acme Buyer Ltd", osekMurshe: "123456782", address: {} },
    lines: [
      {
        description: "Consulting hours",
        quantity: "10.00",
        unitPrice: "1000.00",
        lineTotal: "10000.00",
        vatRate: "18.00",
        vatAmount: "1800.00",
      },
    ],
    totals: { subtotal: "10000.00", vatTotal: "1800.00", grandTotal: "11800.00", currency: "ILS" },
    metadata: { createdAt: "2026-04-20T10:00:00.000Z", createdByUserId: "00000000-0000-0000-0000-000000000000" },
  };
}

function makeInvoiceData(): InvoiceData {
  return {
    invoiceNumber: "2026-TI-999001",
    invoiceDate: "2026-04-20",
    customerName: "Acme Buyer Ltd",
    customerTaxId: "123456782",
    items: [
      { description: "Consulting hours", quantity: 10, unitPrice: 1000, total: 10000 },
    ],
    subtotal: 10000,
    vatRate: 18,
    vatAmount: 1800,
    total: 11800,
    currency: "ILS",
    language: "he",
    documentType: "TAX_INVOICE",
    copyMarker: null,
    payments: [],
  };
}

function makeConfig(issuer: {
  name: string;
  taxId: string | null;
  address: string;
}): TemplateConfig {
  return {
    designId: "classic",
    accentColor: "#6366f1",
    logoUrl: null,
    businessName: issuer.name,
    businessAddress: issuer.address,
    businessTaxId: issuer.taxId ?? "",
    businessPhone: "",
    businessEmail: "",
    businessWebsite: "",
    showVatBreakdown: true,
    defaultCurrency: "ILS",
    defaultLanguage: "he",
  };
}

async function mkFixture(): Promise<Fixture> {
  const email = `verify-issuer-${randomUUID()}@test.local`;
  const [user] = await client<{ id: string }[]>`
    INSERT INTO users (email) VALUES (${email}) RETURNING id
  `;
  const [entity] = await client<{ id: string }[]>`
    INSERT INTO business_entities (owner_user_id, legal_name, entity_type, osek_murshe, address)
    VALUES (
      ${user.id},
      ${ORIGINAL_LEGAL_NAME},
      'OSEK_MURSHE',
      ${ORIGINAL_OSEK},
      ${JSON.stringify({ street: "Rothschild 1", city: "Tel Aviv", zip: "6122001", country: "IL" })}::jsonb
    )
    RETURNING id
  `;
  // A minimal outbound_invoices row so the FK from document_signatures
  // is satisfiable. We only need id/businessEntityId for this fixture.
  const [inv] = await client<{ id: string }[]>`
    INSERT INTO outbound_invoices (
      user_id, business_entity_id, document_type, tax_year, sequence_number,
      formatted_number, invoice_number, invoice_date, items, subtotal, total
    ) VALUES (
      ${user.id}, ${entity.id}, 'TAX_INVOICE', 2026, 999001,
      '2026-TI-999001', '2026-TI-999001', '2026-04-20',
      ${JSON.stringify([{ description: "Consulting hours", quantity: 10, unitPrice: 1000, total: 10000 }])}::jsonb,
      '10000.00', '11800.00'
    ) RETURNING id
  `;
  return { userId: user.id, businessEntityId: entity.id, invoiceId: inv.id };
}

async function cleanup(f: Fixture) {
  await client`DELETE FROM document_signatures WHERE document_id = ${f.invoiceId}`;
  await client`DELETE FROM outbound_invoices WHERE id = ${f.invoiceId}`;
  await client`DELETE FROM business_entities WHERE id = ${f.businessEntityId}`;
  await client`DELETE FROM users WHERE id = ${f.userId}`;
}

// --- 1. Helper purity — entity -------------------------------------------

async function scenarioEntityHelper() {
  const name = "1. buildIssuerIdentityFromEntity — pure formatting";
  const out = buildIssuerIdentityFromEntity({
    legalName: "  ACME Ltd  ",
    osekMurshe: "517193777",
    address: { street: "Rothschild 1", city: "Tel Aviv", zip: "6122001", country: "IL" },
  });
  const ok =
    out.name === "ACME Ltd" &&
    out.taxId === "517193777" &&
    out.address === "Rothschild 1\nTel Aviv 6122001\nIL";
  record(name, ok, `name="${out.name}" taxId=${out.taxId} addr="${out.address.replace(/\n/g, "|")}"`);
}

// --- 2. Canonical helper ------------------------------------------------

async function scenarioCanonicalHelper() {
  const name = "2. buildIssuerIdentityFromCanonical — reads canonical doc";
  const c = makeCanonical("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002");
  const out = buildIssuerIdentityFromCanonical(c);
  const ok =
    out.name === ORIGINAL_LEGAL_NAME &&
    out.taxId === ORIGINAL_OSEK &&
    out.address.includes("Rothschild 1") &&
    out.address.includes("Tel Aviv");
  record(name, ok, `name="${out.name}" taxId=${out.taxId}`);
}

// --- 3. Draft render ---------------------------------------------------

async function scenarioDraftRender() {
  const name = "3. draft render — HTML contains entity legalName + osekMurshe";
  const f = await mkFixture();
  try {
    const [row] = await client<{ legal_name: string; osek_murshe: string; address: unknown }[]>`
      SELECT legal_name, osek_murshe, address FROM business_entities WHERE id = ${f.businessEntityId}
    `;
    const issuer = buildIssuerIdentityFromEntity({
      legalName: row.legal_name,
      osekMurshe: row.osek_murshe,
      address: row.address as never,
    });
    const html = renderInvoiceHtml(makeConfig(issuer), makeInvoiceData());
    const ok =
      html.includes(ORIGINAL_LEGAL_NAME) && html.includes(ORIGINAL_OSEK);
    record(name, ok, ok ? "found legalName + osekMurshe" : "missing from HTML");
  } finally {
    await cleanup(f);
  }
}

// --- 4. Issued render --------------------------------------------------

async function scenarioIssuedRender() {
  const name =
    "4. issued render — HTML populated from canonical JSON after signature insert";
  const keyId = await resolveActiveSigningKeyId();
  if (!keyId) {
    record(
      name,
      false,
      "no ACTIVE signing_keys row — run scripts/generate-dev-signing-key.ts first",
    );
    return;
  }
  const f = await mkFixture();
  try {
    const canonical = makeCanonical(f.invoiceId, f.businessEntityId);
    const now = new Date();
    await client`
      INSERT INTO document_signatures (
        document_id, business_entity_id, canonical_json, canonical_json_hash,
        signature_base64, algorithm, key_id, signed_at, signed_by_user_id
      ) VALUES (
        ${f.invoiceId}, ${f.businessEntityId},
        ${JSON.stringify(canonical)}::jsonb,
        ${"a".repeat(64)}, ${"sig-placeholder"}, 'RS256', ${keyId},
        ${now.toISOString()}, ${f.userId}
      )
    `;
    const [sig] = await client<{ canonical_json: unknown }[]>`
      SELECT canonical_json FROM document_signatures WHERE document_id = ${f.invoiceId}
    `;
    const cj =
      typeof sig.canonical_json === "string"
        ? JSON.parse(sig.canonical_json)
        : sig.canonical_json;
    const issuer = buildIssuerIdentityFromCanonical(cj as CanonicalDocument);
    const html = renderInvoiceHtml(makeConfig(issuer), makeInvoiceData());
    const ok =
      html.includes(ORIGINAL_LEGAL_NAME) && html.includes(ORIGINAL_OSEK);
    record(name, ok, ok ? "found legalName + osekMurshe" : "missing from HTML");
  } finally {
    await cleanup(f);
  }
}

// --- 5. Integrity regression -------------------------------------------

async function scenarioIntegrityRegression() {
  const name =
    "5. mutate entity post-issue; re-render must still show ORIGINAL signed name";
  const keyId = await resolveActiveSigningKeyId();
  if (!keyId) {
    record(
      name,
      false,
      "no ACTIVE signing_keys row — run scripts/generate-dev-signing-key.ts first",
    );
    return;
  }
  const f = await mkFixture();
  try {
    const canonical = makeCanonical(f.invoiceId, f.businessEntityId);
    const now = new Date();
    await client`
      INSERT INTO document_signatures (
        document_id, business_entity_id, canonical_json, canonical_json_hash,
        signature_base64, algorithm, key_id, signed_at, signed_by_user_id
      ) VALUES (
        ${f.invoiceId}, ${f.businessEntityId},
        ${JSON.stringify(canonical)}::jsonb,
        ${"b".repeat(64)}, ${"sig-placeholder"}, 'RS256', ${keyId},
        ${now.toISOString()}, ${f.userId}
      )
    `;
    // Mutate the live entity — simulating a (disallowed) identity
    // drift. Identity lock in updateMyBusinessEntity normally blocks
    // this, but a raw DB update could still happen.
    await client`UPDATE business_entities SET legal_name = ${MUTATED_LEGAL_NAME} WHERE id = ${f.businessEntityId}`;

    const [sig] = await client<{ canonical_json: unknown }[]>`
      SELECT canonical_json FROM document_signatures WHERE document_id = ${f.invoiceId}
    `;
    const cj =
      typeof sig.canonical_json === "string"
        ? JSON.parse(sig.canonical_json)
        : sig.canonical_json;
    const issuer = buildIssuerIdentityFromCanonical(cj as CanonicalDocument);
    const html = renderInvoiceHtml(makeConfig(issuer), makeInvoiceData());
    const showsOriginal = html.includes(ORIGINAL_LEGAL_NAME);
    const leaksMutated = html.includes(MUTATED_LEGAL_NAME);
    const ok = showsOriginal && !leaksMutated;
    record(
      name,
      ok,
      `showsOriginal=${showsOriginal} leaksMutated=${leaksMutated}`,
    );
  } finally {
    await cleanup(f);
  }
}

async function main() {
  console.log("[verify-issuer-identity] starting…\n");
  const scenarios: Array<[string, () => Promise<void>]> = [
    ["entityHelper", scenarioEntityHelper],
    ["canonicalHelper", scenarioCanonicalHelper],
    ["draftRender", scenarioDraftRender],
    ["issuedRender", scenarioIssuedRender],
    ["integrityRegression", scenarioIntegrityRegression],
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
  console.log(`\n[verify-issuer-identity] ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-issuer-identity] fatal:", err);
  process.exit(1);
});
