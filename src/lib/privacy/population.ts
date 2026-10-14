import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Counts the distinct people whose data InvoLoops holds, for the Privacy
 * Protection (Data Security) Regulations.
 *
 * The count is of PEOPLE, not companies, records or invoices. It is
 * deliberately conservative: anything that might be a person is counted.
 *
 * - users — every registered account
 * - invitations — people invited to an account by email
 * - customers — outbound-invoice recipients, keyed by tax id, else email
 * - vendors — inbound-invoice issuers (many are companies; counted anyway)
 * - reverseCharge — buyers asked to sign a reverse-charge consent
 * - outboundRecipients — invoice emails with no customer record attached
 *
 * Deduplication is global: the same email or tax id seen in two tenants, or
 * as both a user and a customer, is one person.
 */

export const POPULATION_THRESHOLD = 10_000;

export const POPULATION_SOURCES = [
  "users",
  "invitations",
  "customers",
  "vendors",
  "reverseCharge",
  "outboundRecipients",
] as const;
export type PopulationSource = (typeof POPULATION_SOURCES)[number];

export interface PopulationCount {
  total: number;
  bySource: Record<PopulationSource, number>;
  /** Customers whose tax id is a ח.פ. (9 digits starting with 5) — likely companies. */
  companyNumberedCustomers: number;
  /** Rows added after `since`, per source. Empty when no `since` was given. */
  newSince: Partial<Record<PopulationSource, number>>;
}

// One row per (person key, source). Keys are prefixed by kind so an email and
// a tax id can never collide.
const PEOPLE_KEYS = sql`
  SELECT 'email:' || lower(trim(email)) AS k, 'users' AS src, created_at::timestamptz AS created_at
    FROM users
  UNION ALL
  SELECT 'email:' || lower(trim(email)), 'invitations', created_at::timestamptz
    FROM account_invitations
  UNION ALL
  SELECT CASE
           WHEN regexp_replace(coalesce(tax_id, ''), '\\D', '', 'g') <> ''
             THEN 'tax:' || regexp_replace(tax_id, '\\D', '', 'g')
           WHEN trim(coalesce(email, '')) <> ''
             THEN 'email:' || lower(trim(email))
           ELSE 'customer:' || id::text
         END,
         'customers', created_at::timestamptz
    FROM customers
  UNION ALL
  SELECT 'vendor:' || lower(trim(name)), 'vendors', created_at::timestamptz
    FROM vendors
  UNION ALL
  SELECT 'email:' || lower(trim(recipient_email)), 'reverseCharge', created_at
    FROM reverse_charge_consents
  UNION ALL
  SELECT 'email:' || lower(trim(customer_email)), 'outboundRecipients', created_at::timestamptz
    FROM outbound_invoices
   WHERE customer_id IS NULL
     AND deleted_at IS NULL
     AND trim(coalesce(customer_email, '')) <> ''
`;

export async function countPopulation(since?: Date | null): Promise<PopulationCount> {
  const sinceIso = since ? since.toISOString() : null;

  const [totals, perSource, companies] = await Promise.all([
    db.execute<{ total: string }>(sql`
      SELECT count(DISTINCT k)::text AS total FROM (${PEOPLE_KEYS}) p
    `),
    db.execute<{ src: string; people: string; added: string }>(sql`
      SELECT src,
             count(DISTINCT k)::text AS people,
             count(*) FILTER (
               WHERE ${sinceIso}::timestamptz IS NOT NULL
                 AND created_at > ${sinceIso}::timestamptz
             )::text AS added
        FROM (${PEOPLE_KEYS}) p
       GROUP BY src
    `),
    db.execute<{ n: string }>(sql`
      SELECT count(DISTINCT regexp_replace(tax_id, '\\D', '', 'g'))::text AS n
        FROM customers
       WHERE regexp_replace(coalesce(tax_id, ''), '\\D', '', 'g') ~ '^5[0-9]{8}$'
    `),
  ]);

  const bySource = Object.fromEntries(
    POPULATION_SOURCES.map((s) => [s, 0]),
  ) as Record<PopulationSource, number>;
  const newSince: Partial<Record<PopulationSource, number>> = {};

  for (const row of perSource) {
    const src = row.src as PopulationSource;
    if (!POPULATION_SOURCES.includes(src)) continue;
    bySource[src] = Number(row.people);
    if (sinceIso) newSince[src] = Number(row.added);
  }

  return {
    total: Number(totals[0]?.total ?? 0),
    bySource,
    companyNumberedCustomers: Number(companies[0]?.n ?? 0),
    newSince,
  };
}
