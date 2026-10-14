import signpdf from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
import { SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";
import { loadPdfSigningMaterial } from "./pdf-key-store";

/**
 * PAdES-B signer for invoice PDFs.
 *
 * Byte-in / byte-out: takes the Puppeteer-rendered PDF bytes, inserts
 * a `/Type /Sig` dictionary with `/SubFilter /ETSI.CAdES.detached` and
 * a `/ByteRange` placeholder, then fills the placeholder with a CMS
 * container produced from the PKCS#12 keystore.
 *
 * PAdES-B only — no timestamp authority, no OCSP/CRL embedding, no
 * visible signature appearance (ETSI EN 319 142-1 §5.3 "Baseline B").
 * Adobe Reader will show a blue ribbon ("signed but signer not trusted"
 * for self-signed dev certs). `pdfsig` will print
 * "Signature Type: ETSI.CAdES.detached" and "Signature is Valid".
 *
 * Complements — does not replace — the Spec 04 canonical-JSON
 * signature stored in `document_signatures`. Both layers protect
 * different artifacts.
 */

/** PAdES metadata stamped into the signature dictionary. */
const SIGNER_NAME = "InvoLoops";
const SIGNER_LOCATION = "Herzliya, Israel";
const SIGNER_REASON = "Invoice integrity and authenticity";
const SIGNER_CONTACT = "";

/**
 * 16KB reserved for the CMS blob — room for a full cert chain and
 * headroom for a future timestamp token without needing to re-render
 * the PDF. (@signpdf default is 8KB, which is tight once a real CA
 * chain is in play.)
 */
const SIGNATURE_LENGTH = 16384;

export async function signPdfBuffer(unsignedPdf: Buffer): Promise<Buffer> {
  const material = loadPdfSigningMaterial();

  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer: unsignedPdf,
    reason: SIGNER_REASON,
    contactInfo: SIGNER_CONTACT,
    name: SIGNER_NAME,
    location: SIGNER_LOCATION,
    signatureLength: SIGNATURE_LENGTH,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
  });

  const signer = new P12Signer(material.p12Buffer, {
    passphrase: material.passphrase,
  });

  return signpdf.sign(withPlaceholder, signer);
}
