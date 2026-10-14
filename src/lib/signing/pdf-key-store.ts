import { readFileSync } from "node:fs";
import forge from "node-forge";

/**
 * PKCS#12 keystore access for the PAdES-B PDF signer.
 *
 * Isolated from the Spec 04 JSON-signing key (see `./key-store.ts`):
 * different purpose (PDF artifact integrity vs. canonical-JSON record
 * integrity), different rotation schedule, different cert requirements
 * (one may move to a Comsign-issued cert later; the other stays
 * internal). Three env vars:
 *   INVOLOOPS_PDF_SIGNING_P12_PATH      absolute path to the .p12
 *   INVOLOOPS_PDF_SIGNING_P12_PASSWORD  passphrase
 *   INVOLOOPS_PDF_SIGNING_ALIAS         informational / audit only
 *
 * Loaded once per process and cached. Missing env = clear boot-time
 * error pointing at `scripts/generate-dev-pdf-signing-keystore.sh`.
 * Callers that want a soft feature-flag should use
 * `isPdfSigningConfigured()`.
 */

export interface PdfSigningMaterial {
  /** Raw .p12 bytes, suitable for `@signpdf/signer-p12` P12Signer. */
  p12Buffer: Buffer;
  /** Passphrase decrypting the .p12. */
  passphrase: string;
  /** Alias recorded in audit entries; purely informational. */
  alias: string;
  /** Subject CN of the first cert in the keystore (for logs / audit). */
  certSubjectCn: string;
}

let cached: PdfSigningMaterial | undefined;

const PATH_VAR = "INVOLOOPS_PDF_SIGNING_P12_PATH";
const PASSWORD_VAR = "INVOLOOPS_PDF_SIGNING_P12_PASSWORD";
const ALIAS_VAR = "INVOLOOPS_PDF_SIGNING_ALIAS";

export function isPdfSigningConfigured(): boolean {
  return Boolean(
    process.env[PATH_VAR]?.trim() && process.env[PASSWORD_VAR]?.trim(),
  );
}

export function loadPdfSigningMaterial(): PdfSigningMaterial {
  if (cached) return cached;

  const path = process.env[PATH_VAR]?.trim();
  const passphrase = process.env[PASSWORD_VAR]?.trim();
  const alias = process.env[ALIAS_VAR]?.trim() || "involoops-pdf-dev";

  if (!path) {
    throw new Error(
      `${PATH_VAR} is not set. Run \`scripts/generate-dev-pdf-signing-keystore.sh\` and point this env var at the resulting .p12.`,
    );
  }
  if (!passphrase) {
    throw new Error(
      `${PASSWORD_VAR} is not set. Use the same passphrase you passed when running generate-dev-pdf-signing-keystore.sh.`,
    );
  }

  let p12Buffer: Buffer;
  try {
    p12Buffer = readFileSync(path);
  } catch (err) {
    throw new Error(
      `Failed to read PDF signing keystore at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const certSubjectCn = extractCertSubjectCn(p12Buffer, passphrase);

  cached = { p12Buffer, passphrase, alias, certSubjectCn };
  return cached;
}

/**
 * Returns the CN of the first certificate in the keystore. Used by the
 * verification script and for audit logging; failure here is fatal
 * because it means the passphrase is wrong or the file is corrupted —
 * either way, signing will fail later, and we'd rather fail at boot.
 */
function extractCertSubjectCn(p12Buffer: Buffer, passphrase: string): string {
  const asn1 = forge.asn1.fromDer(
    forge.util.createBuffer(p12Buffer.toString("binary")),
  );
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const bag = certBags[forge.pki.oids.certBag]?.[0];
  if (!bag || !bag.cert) {
    throw new Error(
      "PDF signing keystore did not contain a certificate. Re-run generate-dev-pdf-signing-keystore.sh.",
    );
  }
  const cnAttr = bag.cert.subject.getField("CN");
  return cnAttr?.value ?? "(no CN)";
}

/** Test-only hook. Do not call from application code. */
export function __resetPdfSigningCacheForTests(): void {
  cached = undefined;
}
