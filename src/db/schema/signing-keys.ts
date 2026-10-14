import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const SIGNING_KEY_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "ES256",
] as const;

export type SigningKeyAlgorithm = (typeof SIGNING_KEY_ALGORITHMS)[number];

export const signingKeyAlgorithmEnum = pgEnum(
  "signing_key_algorithm",
  SIGNING_KEY_ALGORITHMS,
);

export const SIGNING_KEY_STATUSES = ["ACTIVE", "RETIRED", "REVOKED"] as const;

export type SigningKeyStatus = (typeof SIGNING_KEY_STATUSES)[number];

export const signingKeyStatusEnum = pgEnum(
  "signing_key_status",
  SIGNING_KEY_STATUSES,
);

/**
 * Public-key metadata for the signing keys InvoLoops uses to sign issued
 * documents (Spec 04, חשבונית ירוקה). Private keys are NEVER stored in
 * the database. Production reads `SIGNING_PRIVATE_KEY_FILE` (a PEM
 * mounted read-only). Dev may use `SIGNING_PRIVATE_KEY_PEM`.
 *
 * `keyId` is the stable identifier embedded in every signature row and
 * printed on PDF footers. Rotation adds a new ACTIVE row and sets the
 * previous row to RETIRED; that public key is never deleted or edited,
 * so older documents keep verifying. REVOKED is a leak response:
 * signatures after `revokedAfter` fail, and a null cutoff fails all of them.
 */
export const signingKeys = pgTable(
  "signing_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    keyId: text("key_id").notNull().unique(),
    algorithm: signingKeyAlgorithmEnum("algorithm").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    /** X.509 wrapper if we have one (optional today; required in prod). */
    certificatePem: text("certificate_pem"),
    /** e.g. `CN=InvoLoops, O=TTP GO LTD, C=IL`. */
    subject: text("subject").notNull(),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    notAfter: timestamp("not_after", { withTimezone: true }).notNull(),
    status: signingKeyStatusEnum("status").notNull().default("ACTIVE"),
    /**
     * When `status` is `REVOKED`, signatures with `signed_at` strictly after
     * this instant are invalid. Null means every signature from the key is
     * invalid. Ignored unless the key is REVOKED.
     */
    revokedAfter: timestamp("revoked_after", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Partial index so `WHERE status = 'ACTIVE'` is effectively a
    // single-row lookup. Only one row should be ACTIVE at any time, but
    // the invariant is enforced at the application layer because key
    // rotation is a two-step promote/demote.
    index("signing_keys_active_idx")
      .on(table.keyId)
      .where(sql`status = 'ACTIVE'`),
  ],
);
