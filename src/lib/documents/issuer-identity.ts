import type { BusinessEntityAddress } from "@/db/schema/business-entities";
import type { CanonicalDocument } from "@/lib/signing/canonical-document";

/**
 * Single source of issuer-identity formatting for outbound invoice
 * rendering. ITA rule: every invoice must carry the issuer's legal
 * name, tax ID, and registered address. We read from two places:
 *
 *   - Drafts → live `business_entities` row (identity is locked after
 *     first save, so this is stable).
 *   - Issued documents → the signed `canonical_json` on the document's
 *     signature row. This is the integrity guarantee: the PDF must
 *     always show what was signed, never a later mutation of the
 *     entity (even though identity is locked, we still read from the
 *     signature to defend against any future schema drift).
 *
 * `invoice_templates.business_*` columns are UI-preview leftovers and
 * MUST NOT be used for issuer identity.
 */

export interface IssuerIdentity {
  /** Legal name — MUST be non-empty; throws otherwise. */
  name: string;
  /** 9-digit Osek Murshe or company tax ID, or null for OSEK_PATUR. */
  taxId: string | null;
  /** Pre-formatted newline-joined address string, may be empty. */
  address: string;
}

export class MissingIssuerIdentityError extends Error {
  constructor(source: string) {
    super(
      `Cannot render invoice without an issuer legal name (source: ${source}). ` +
        `This indicates a compliance gap — business_entity.legalName must be set.`,
    );
  }
}

interface EntityLikeForIssuer {
  legalName: string | null;
  osekMurshe: string | null;
  address: BusinessEntityAddress | null;
}

function formatAddress(
  parts: {
    street?: string;
    city?: string;
    zip?: string;
    country?: string;
  } | null,
): string {
  if (!parts) return "";
  const lines: string[] = [];
  if (parts.street && parts.street.trim()) lines.push(parts.street.trim());
  // city + zip go on one line when both present, per IL address convention.
  const cityZip = [parts.city, parts.zip]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (cityZip) lines.push(cityZip);
  if (parts.country && parts.country.trim()) lines.push(parts.country.trim());
  return lines.join("\n");
}

/**
 * Build issuer identity from a live business entity. Use on draft
 * render paths.
 */
export function buildIssuerIdentityFromEntity(
  entity: EntityLikeForIssuer,
): IssuerIdentity {
  const name = (entity.legalName ?? "").trim();
  if (!name) throw new MissingIssuerIdentityError("business_entity.legalName");
  const taxId =
    entity.osekMurshe && entity.osekMurshe.trim() ? entity.osekMurshe.trim() : null;
  return {
    name,
    taxId,
    address: formatAddress(entity.address),
  };
}

/**
 * Build issuer identity from a stored canonical JSON (the payload the
 * signature was computed over). Use on issued/sent/paid/voided render
 * paths so the PDF shows exactly what was signed.
 */
export function buildIssuerIdentityFromCanonical(
  canonical: CanonicalDocument,
): IssuerIdentity {
  const name = (canonical.businessEntity.legalName ?? "").trim();
  if (!name) {
    throw new MissingIssuerIdentityError("canonical_json.businessEntity.legalName");
  }
  return {
    name,
    taxId: canonical.businessEntity.osekMurshe ?? null,
    address: formatAddress(canonical.businessEntity.address ?? null),
  };
}
