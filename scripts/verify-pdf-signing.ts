/**
 * Manual verification harness for PAdES-B PDF signing.
 *
 * Run: `npx tsx scripts/verify-pdf-signing.ts`
 *
 * If INVOLOOPS_PDF_SIGNING_P12_PATH / _PASSWORD are set, uses that
 * keystore. Otherwise generates a disposable self-signed P12 in /tmp
 * and runs against that — so the script is self-contained for a quick
 * local sanity check without needing to run the openssl bootstrap
 * script first.
 *
 * Scenarios:
 *   1. Keystore loads — cert CN is readable.
 *   2. Signs a minimal PDF — output > input, valid bytes.
 *   3. PAdES dictionary present — /Type /Sig, /SubFilter
 *      ETSI.CAdES.detached, /ByteRange all appear in the signed bytes.
 *   4. Integration through generateInvoicePdf — non-draft signs,
 *      draft does not. (This one launches Puppeteer; skipped with
 *      SKIP_PUPPETEER=1.)
 *   5. Tamper detection — flip a byte inside the signed /ByteRange,
 *      assert messageDigest in CMS signedAttrs no longer matches
 *      SHA-256 of the tampered range. Proves the signature binds to
 *      the PDF content, not just that a /Sig dict exists.
 *
 * External validation (run manually after this script):
 *   pdfsig /tmp/verify-pdf-signing-signed.pdf
 * Expected:
 *   Signature Type: ETSI.CAdES.detached
 *   Signature is Valid.
 *   Certificate Validation: Certificate has Expired or is Untrusted.
 * The "Untrusted" line is expected for self-signed dev certs — the
 * signature itself is cryptographically valid. Adobe Reader shows the
 * blue ribbon ("signed but signer not trusted").
 *
 * Manual tamper cross-check (if you want to confirm pdfsig agrees):
 *   printf '\xff' | dd of=/tmp/verify-pdf-signing-signed.pdf \
 *     bs=1 seek=1000 count=1 conv=notrunc
 *   pdfsig /tmp/verify-pdf-signing-signed.pdf
 * Expected: "Signature is Invalid" (or "Digest mismatch").
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import forge from "node-forge";
import { PDFDocument, StandardFonts } from "pdf-lib";

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

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Build a disposable self-signed .p12 entirely in-memory when the
 * env keystore isn't configured. Mirrors the openssl bootstrap script
 * but avoids the shell round-trip so the harness Just Works locally.
 */
function ensureKeystoreConfigured(): void {
  if (
    process.env.INVOLOOPS_PDF_SIGNING_P12_PATH &&
    process.env.INVOLOOPS_PDF_SIGNING_P12_PASSWORD
  ) {
    return;
  }
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [
    { name: "commonName", value: "InvoLoops Development" },
    { name: "organizationName", value: "TTP GO LTD" },
    { name: "countryName", value: "IL" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const passphrase = "verify-pdf-signing-dev";
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    passphrase,
    { algorithm: "3des" },
  );
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, "binary");

  const dir = mkdtempSync(join(tmpdir(), "involoops-pdf-signing-"));
  const p12Path = join(dir, "verify-dev.p12");
  writeFileSync(p12Path, p12Buffer);
  process.env.INVOLOOPS_PDF_SIGNING_P12_PATH = p12Path;
  process.env.INVOLOOPS_PDF_SIGNING_P12_PASSWORD = passphrase;
  process.env.INVOLOOPS_PDF_SIGNING_ALIAS = "involoops-pdf-dev-ephemeral";
  console.log(`[verify-pdf-signing] using ephemeral keystore at ${p12Path}`);
}

async function buildMinimalPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 50, y: 350, size: 14, font });
  // `@signpdf/signpdf` only parses the classic `xref` table format.
  // pdf-lib's default emits a compressed PDF 1.5+ xref stream which
  // makes signpdf's `startxref` lookup return NaN. Force the legacy
  // layout for the signing fixture. Real invoice PDFs are produced
  // by Puppeteer/Chromium and already use the classic xref.
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/**
 * Extract the /ByteRange and the CMS container from a PAdES-signed PDF.
 * Returns the bytes that were signed (concatenation of the two ranges)
 * and the DER-encoded CMS blob hex-decoded from /Contents.
 */
function extractSignatureEnvelope(pdf: Buffer): {
  byteRange: [number, number, number, number];
  signedContent: Buffer;
  cmsDer: Buffer;
} {
  const text = pdf.toString("latin1");
  const brMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
    text,
  );
  if (!brMatch) throw new Error("no /ByteRange in PDF");
  const a = Number(brMatch[1]);
  const b = Number(brMatch[2]);
  const c = Number(brMatch[3]);
  const d = Number(brMatch[4]);
  const contentsMatch = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(text);
  if (!contentsMatch) throw new Error("no /Contents in PDF");
  const cmsDer = Buffer.from(contentsMatch[1], "hex");
  const signedContent = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  return { byteRange: [a, b, c, d], signedContent, cmsDer };
}

/**
 * Walk the CMS SignedData ASN.1 tree and pull the messageDigest
 * attribute from the first signer's signedAttrs. PAdES (CAdES
 * detached) always carries signedAttrs with a messageDigest = SHA-256
 * of the detached content — we can compare it to our own SHA-256 of
 * the /ByteRange bytes to detect tampering without a full PKCS#7
 * verifier.
 */
function extractMessageDigest(cmsDer: Buffer): Buffer {
  // PAdES `/Contents` is hex-padded with trailing 0x00 to fill the
  // reserved signature space, so the hex-decoded buffer contains the
  // CMS SEQUENCE followed by zero bytes. forge's `parseAllBytes`
  // option (default true) rejects trailing bytes — disable it so we
  // parse only the leading SignedData and ignore the padding.
  //
  // @types/node-forge declares the second arg as `boolean | undefined`
  // and omits the options-object overload that the runtime supports,
  // so we cast to the real signature here. Boolean shorthand would
  // force parseAllBytes:true, which is exactly what we need off.
  const fromDerWithOptions = forge.asn1.fromDer as unknown as (
    bytes: forge.util.ByteStringBuffer | string,
    options: { strict?: boolean; parseAllBytes?: boolean },
  ) => forge.asn1.Asn1;
  const asn1 = fromDerWithOptions(
    forge.util.createBuffer(cmsDer.toString("binary")),
    { strict: false, parseAllBytes: false },
  );
  // ContentInfo SEQUENCE -> [OID signedData, [0] EXPLICIT SignedData]
  const contentInfo = asn1.value as forge.asn1.Asn1[];
  const explicit = contentInfo[1] as forge.asn1.Asn1;
  const signedData = (explicit.value as forge.asn1.Asn1[])[0];
  // SignedData fields end with `SET signerInfos`. There may be an
  // earlier SET (digestAlgorithms) so take the last SET node.
  const signedDataValue = signedData.value as forge.asn1.Asn1[];
  const sets = signedDataValue.filter(
    (n) => n.type === forge.asn1.Type.SET,
  );
  const signerInfos = sets[sets.length - 1];
  const signerInfo = (signerInfos.value as forge.asn1.Asn1[])[0];
  const signerInfoValue = signerInfo.value as forge.asn1.Asn1[];
  const signedAttrs = signerInfoValue.find(
    (n) =>
      n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && (n.type as number) === 0,
  );
  if (!signedAttrs) throw new Error("no signedAttrs (not a CAdES signature?)");
  const messageDigestOid = forge.pki.oids.messageDigest;
  for (const attr of signedAttrs.value as forge.asn1.Asn1[]) {
    const attrSeq = attr.value as forge.asn1.Asn1[];
    const oidBytes = attrSeq[0].value as string;
    const oid = forge.asn1.derToOid(oidBytes);
    if (oid === messageDigestOid) {
      const attrValues = attrSeq[1];
      const octetString = (attrValues.value as forge.asn1.Asn1[])[0];
      return Buffer.from(octetString.value as string, "binary");
    }
  }
  throw new Error("messageDigest attribute not found in signedAttrs");
}

// --- Scenarios ------------------------------------------------------------

async function scenarioKeystoreLoads(): Promise<void> {
  const { loadPdfSigningMaterial, __resetPdfSigningCacheForTests } = await import(
    "@/lib/signing/pdf-key-store"
  );
  __resetPdfSigningCacheForTests();
  const material = loadPdfSigningMaterial();
  const ok =
    material.p12Buffer.length > 0 &&
    Boolean(material.passphrase) &&
    Boolean(material.certSubjectCn);
  record(
    "1. keystore loads — cert CN readable",
    ok,
    `cn="${material.certSubjectCn}" p12=${material.p12Buffer.length}B`,
  );
}

async function scenarioSignsMinimalPdf(): Promise<Buffer | null> {
  const { signPdfBuffer } = await import("@/lib/signing/pdf-sign");
  const unsigned = await buildMinimalPdf("PAdES-B verify fixture");
  const signed = await signPdfBuffer(unsigned);
  const ok = signed.length > unsigned.length && signed.slice(0, 4).toString() === "%PDF";
  record(
    "2. signs minimal PDF — output > input",
    ok,
    `unsigned=${unsigned.length}B signed=${signed.length}B`,
  );
  if (!ok) return null;
  const outPath = join(tmpdir(), "verify-pdf-signing-signed.pdf");
  writeFileSync(outPath, signed);
  console.log(`       wrote ${outPath} — run \`pdfsig ${outPath}\` to cross-check.`);
  return signed;
}

function scenarioPadesDictionary(signed: Buffer): void {
  const text = signed.toString("latin1");
  const hasSig = text.includes("/Type /Sig") || text.includes("/Type/Sig");
  const hasCades = text.includes("/ETSI.CAdES.detached");
  const hasByteRange = /\/ByteRange\s*\[/.test(text);
  const ok = hasSig && hasCades && hasByteRange;
  record(
    "3. PAdES dict present — /Type /Sig, /SubFilter /ETSI.CAdES.detached, /ByteRange",
    ok,
    `sig=${hasSig} cades=${hasCades} byteRange=${hasByteRange}`,
  );
}

async function scenarioGenerateInvoicePdfIntegration(): Promise<void> {
  if (process.env.SKIP_PUPPETEER === "1") {
    record(
      "4. generateInvoicePdf integration — skipped (SKIP_PUPPETEER=1)",
      true,
      "skipped",
    );
    return;
  }
  const { generateInvoicePdf } = await import("@/lib/pdf/generate-pdf");
  const config = {
    designId: "classic" as const,
    accentColor: "#6366f1",
    businessName: "Verify Fixture Ltd",
    businessAddress: "",
    businessPhone: "",
    businessEmail: "",
    businessTaxId: "",
    businessWebsite: "",
    showVatBreakdown: true,
    defaultCurrency: "ILS",
    defaultLanguage: "he" as const,
  };
  const invoice = {
    invoiceNumber: "V-0001",
    invoiceDate: "2026-04-20",
    customerName: "Fixture Customer",
    items: [{ description: "Widget", quantity: 1, unitPrice: 100, total: 100 }],
    subtotal: 100,
    vatRate: 18,
    vatAmount: 18,
    total: 118,
    currency: "ILS",
    language: "he" as const,
    documentType: "TAX_INVOICE" as const,
  };
  const nonDraft = await generateInvoicePdf(config, invoice, { isDraft: false });
  const draft = await generateInvoicePdf(config, invoice, { isDraft: true });
  const nonDraftText = nonDraft.buffer.toString("latin1");
  const draftText = draft.buffer.toString("latin1");
  const nonDraftSigned = /\/ByteRange\s*\[/.test(nonDraftText) && nonDraft.padesSigned;
  const draftUnsigned = !/\/ByteRange\s*\[/.test(draftText) && !draft.padesSigned;
  const ok = nonDraftSigned && draftUnsigned;
  record(
    "4. generateInvoicePdf — non-draft signs, draft does not",
    ok,
    `nonDraftSigned=${nonDraftSigned} draftUnsigned=${draftUnsigned}`,
  );
}

function scenarioTamperDetection(signed: Buffer): void {
  const envelope = extractSignatureEnvelope(signed);
  const expectedDigest = extractMessageDigest(envelope.cmsDer);
  const actualDigest = createHash("sha256").update(envelope.signedContent).digest();
  const cleanMatches = expectedDigest.equals(actualDigest);

  // Flip a byte inside the first signed range (never inside /Contents,
  // which sits between the two ranges and is excluded from the signed
  // bytes by design).
  const tampered = Buffer.from(signed);
  const [a, b] = envelope.byteRange;
  // Pick an offset past the PDF header, well inside the first range.
  const tamperOffset = Math.min(a + b - 50, a + 200);
  tampered[tamperOffset] = tampered[tamperOffset] ^ 0xff;

  const tamperedEnvelope = extractSignatureEnvelope(tampered);
  const tamperedDigest = createHash("sha256")
    .update(tamperedEnvelope.signedContent)
    .digest();
  const tamperedDetected = !tamperedDigest.equals(expectedDigest);

  const ok = cleanMatches && tamperedDetected;
  record(
    "5. tamper detection — one-byte flip invalidates messageDigest",
    ok,
    `clean=${cleanMatches} tampered=${tamperedDetected} offset=${tamperOffset}`,
  );
}

async function main(): Promise<void> {
  console.log("[verify-pdf-signing] starting…\n");
  ensureKeystoreConfigured();

  try {
    await scenarioKeystoreLoads();
  } catch (err) {
    record("1. keystore loads", false, err instanceof Error ? err.message : String(err));
  }

  let signed: Buffer | null = null;
  try {
    signed = await scenarioSignsMinimalPdf();
  } catch (err) {
    record(
      "2. signs minimal PDF",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (signed) {
    try {
      scenarioPadesDictionary(signed);
    } catch (err) {
      record(
        "3. PAdES dict present",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
    try {
      scenarioTamperDetection(signed);
    } catch (err) {
      record(
        "5. tamper detection",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    record("3. PAdES dict present", false, "skipped: scenario 2 failed");
    record("5. tamper detection", false, "skipped: scenario 2 failed");
  }

  try {
    await scenarioGenerateInvoicePdfIntegration();
  } catch (err) {
    record(
      "4. generateInvoicePdf integration",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n[verify-pdf-signing] ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-pdf-signing] fatal:", err);
  process.exit(1);
});
