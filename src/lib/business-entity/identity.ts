import type {
  BusinessEntityAddress,
  EntityType,
} from "@/db/schema/business-entities";

export type EntityIdentity = {
  legalName?: string | null;
  osekMurshe?: string | null;
  entityType?: EntityType | null;
  address?: BusinessEntityAddress | null;
};

/**
 * Fields that must never change after the first save. The 9-digit tax
 * ID (osekMurshe) is what ties the tenant to gov.il authorizations
 * and appears on every signed invoice, so it is immutable once set;
 * entityType is locked alongside it because it determines how the
 * number is interpreted (Osek Murshe / ח.פ. / ע.ר. / partnership
 * number all share the same column). Account holders cannot change a
 * stored number here. Support may correct one only through
 * `correctOsekMurshe`, and only when the entity has no non-draft
 * documents. Everything else (legalName,
 * address, phone, email, legalNameEn, taxYearStartsMonth) is
 * mutable — issued invoices snapshot those fields into
 * documentSignatures, so corrections to the live entity do not alter
 * already-signed documents.
 */
export const LOCKED_IDENTITY_FIELDS = [
  "osekMurshe",
  "entityType",
] as const;

export class EntityIdentityLockedError extends Error {
  readonly field: (typeof LOCKED_IDENTITY_FIELDS)[number];
  constructor(field: (typeof LOCKED_IDENTITY_FIELDS)[number]) {
    super(
      `Cannot modify business-entity identity field "${field}" after initial save. ` +
        `Identity fields are immutable once set to preserve invoice integrity.`,
    );
    this.field = field;
  }
}

function normaliseText(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t.toLowerCase();
}

/**
 * Throws if `incoming` tries to change a locked identity field that
 * was already set on `current`. Unset-to-set transitions (first
 * save) are allowed for every field.
 */
export function assertIdentityLock(
  current: EntityIdentity,
  incoming: EntityIdentity,
): void {
  const pairs: Array<
    [(typeof LOCKED_IDENTITY_FIELDS)[number], string | null, string | null]
  > = [
    [
      "osekMurshe",
      normaliseText(current.osekMurshe),
      normaliseText(incoming.osekMurshe),
    ],
    [
      "entityType",
      normaliseText(current.entityType ?? null),
      normaliseText(incoming.entityType ?? null),
    ],
  ];
  for (const [field, was, now] of pairs) {
    if (was != null && now !== was) {
      throw new EntityIdentityLockedError(field);
    }
  }
}

/**
 * ITA rule: a tax invoice must include the issuer's legal name, tax
 * ID, and registered address. An invoice with any of these missing
 * cannot be issued.
 */
export type MissingIssuerFields = Array<
  "legalName" | "osekMurshe" | "addressStreet" | "addressCity"
>;

export function getMissingIssuerFields(
  entity: EntityIdentity,
): MissingIssuerFields {
  const missing: MissingIssuerFields = [];
  if (!normaliseText(entity.legalName)) missing.push("legalName");
  if (!entity.osekMurshe || !/^\d{9}$/.test(entity.osekMurshe.trim())) {
    missing.push("osekMurshe");
  }
  const street = normaliseText(entity.address?.street ?? null);
  const city = normaliseText(entity.address?.city ?? null);
  if (!street) missing.push("addressStreet");
  if (!city) missing.push("addressCity");
  return missing;
}

export function isIssuerReady(entity: EntityIdentity): boolean {
  return getMissingIssuerFields(entity).length === 0;
}

export class IssuerNotReadyError extends Error {
  readonly missing: MissingIssuerFields;
  constructor(missing: MissingIssuerFields) {
    super(
      `Cannot create invoice: issuer business details are incomplete. ` +
        `Missing: ${missing.join(", ")}.`,
    );
    this.missing = missing;
  }
}
