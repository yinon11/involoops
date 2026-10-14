import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reverseChargeConsents } from "@/db/schema";
import { archiveAuxiliary } from "@/lib/archive/auxiliary";
import { renderHtmlToPdf } from "@/lib/pdf/html-to-pdf";
import {
  renderConsentText,
  type ConsentLocale,
  type ConsentSnapshot,
} from "@/lib/outbound/reverse-charge-consent";

type Consent = typeof reverseChargeConsents.$inferSelect;

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The signed consent as a human-readable page: what the buyer was shown,
 * the drawn signature, and the evidence around it.
 *
 * The text printed is the stored `consent_text` — exactly what was signed.
 * Only for a consent signed before that column existed is it re-rendered
 * from the snapshot, and then the page says whether the re-render still
 * matches the stored hash rather than presenting it as the original.
 */
export function renderConsentEvidenceHtml(consent: Consent): string {
  const snapshot = consent.documentSnapshot as unknown as ConsentSnapshot;
  const locale: ConsentLocale = consent.consentLocale === "en" ? "en" : "he";
  const text =
    consent.consentText ?? renderConsentText(locale, snapshot);
  const textMatches = sha256(text) === consent.consentTextHash;
  const dir = locale === "he" ? "rtl" : "ltr";
  const L =
    locale === "he"
      ? {
          title: "אישור הסכמה להיפוך חיוב — רשומה חתומה",
          seller: "מוכר", buyer: "קונה", date: "תאריך העסקה", amount: "סכום לפני מע״מ",
          text: "הנוסח שנחתם", signer: "החותם", role: "תפקיד", signedAt: "מועד החתימה",
          ip: "כתובת IP", ua: "דפדפן", email: "נשלח אל", requestedAt: "מועד הבקשה",
          ack: "אישור המוכר (אחריות המוכר)", hashes: "טביעות (SHA-256)",
          snapshotHash: "פרטי העסקה", textHash: "נוסח ההסכמה", version: "גרסת נוסח",
          mismatch: "שימו לב: הנוסח שוחזר מתוך פרטי העסקה ואינו תואם את טביעת הנוסח שנשמרה בעת החתימה.",
        }
      : {
          title: "Reverse-charge consent — signed record",
          seller: "Seller", buyer: "Buyer", date: "Transaction date", amount: "Amount before VAT",
          text: "Text signed", signer: "Signer", role: "Role", signedAt: "Signed at",
          ip: "IP address", ua: "Browser", email: "Sent to", requestedAt: "Requested at",
          ack: "Seller acknowledgement (seller's responsibility)", hashes: "Fingerprints (SHA-256)",
          snapshotHash: "Transaction facts", textHash: "Consent text", version: "Text version",
          mismatch: "Note: this text was re-rendered from the transaction facts and does not match the text fingerprint stored at signing.",
        };
  const row = (k: string, v: string | null | undefined) =>
    `<tr><th>${esc(k)}</th><td dir="auto">${esc(v)}</td></tr>`;
  const items = snapshot.items
    .map(
      (i) =>
        `<tr><td>${esc(i.description)}</td><td class="n">${i.quantity}</td><td class="n">${i.unitPrice.toFixed(2)}</td><td class="n">${i.total.toFixed(2)}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html><html lang="${locale}" dir="${dir}"><head><meta charset="UTF-8" />
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color:#111827; font-size:12px; line-height:1.5; }
  h1 { font-size:18px; margin:0 0 12px; }
  h2 { font-size:13px; margin:18px 0 6px; }
  table { border-collapse:collapse; width:100%; }
  th, td { text-align:start; padding:3px 6px; vertical-align:top; border-bottom:1px solid #e5e7eb; }
  th { width:32%; color:#4b5563; font-weight:500; }
  td.n { text-align:end; }
  .text { white-space:pre-line; border:1px solid #d97706; background:#fffbeb; padding:10px; border-radius:4px; }
  .warn { color:#b91c1c; font-weight:600; }
  .sig { border:1px dashed #9ca3af; padding:6px; max-width:320px; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size:10px; word-break:break-all; }
</style></head><body>
<h1>${esc(L.title)}</h1>
<table>
  ${row(L.seller, `${snapshot.seller.name}${snapshot.seller.vatNumber ? ` (${snapshot.seller.vatNumber})` : ""}`)}
  ${row(L.buyer, `${snapshot.buyer.name} (${snapshot.buyer.taxId})`)}
  ${row(L.date, snapshot.invoiceDate)}
  ${row(L.amount, `${snapshot.subtotal} ${snapshot.currency}`)}
</table>
<table style="margin-top:8px">${items}</table>
<h2>${esc(L.text)}</h2>
<div class="text">${esc(text)}</div>
${textMatches ? "" : `<p class="warn">${esc(L.mismatch)}</p>`}
<h2>${esc(L.signer)}</h2>
<table>
  ${row(L.signer, consent.signerName)}
  ${row(L.role, consent.signerRole)}
  ${row(L.signedAt, consent.signedAt?.toISOString() ?? "")}
  ${row(L.ip, consent.signerIp)}
  ${row(L.ua, consent.signerUserAgent)}
  ${row(L.email, consent.recipientEmail)}
  ${row(L.requestedAt, consent.requestedAt.toISOString())}
  ${row(L.ack, `${consent.sellerAcknowledgedAt.toISOString()} · ${consent.sellerAcknowledgementVersion}`)}
  ${row(L.version, consent.consentTextVersion)}
</table>
${consent.signaturePng ? `<p style="margin-top:10px"><img class="sig" src="${esc(consent.signaturePng)}" alt="signature" /></p>` : ""}
<h2>${esc(L.hashes)}</h2>
<table>
  <tr><th>${esc(L.snapshotHash)}</th><td class="mono">${esc(consent.documentSnapshotHash)}</td></tr>
  <tr><th>${esc(L.textHash)}</th><td class="mono">${esc(consent.consentTextHash)}</td></tr>
  <tr><th>consent id</th><td class="mono">${esc(consent.id)}</td></tr>
  <tr><th>document id</th><td class="mono">${esc(consent.documentId)}</td></tr>
</table>
</body></html>`;
}

/**
 * Archive the signed consent (object-lock bucket, entity hash chain) once.
 * Idempotent: a consent already archived is left alone, so retrying an
 * issue that failed later does not write a second copy.
 */
export async function archiveConsentEvidence(params: {
  consentId: string;
  actorUserId: string;
}): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const [consent] = await db
    .select()
    .from(reverseChargeConsents)
    .where(eq(reverseChargeConsents.id, params.consentId))
    .limit(1);
  if (!consent) return { ok: false, error: "consent not found" };
  if (consent.status !== "signed") return { ok: false, error: "consent is not signed" };
  if (consent.archiveKey) return { ok: true, key: consent.archiveKey };

  try {
    const pdf = await renderHtmlToPdf(renderConsentEvidenceHtml(consent));
    const { key } = await archiveAuxiliary({
      businessEntityId: consent.businessEntityId,
      actorUserId: params.actorUserId,
      documentId: consent.documentId,
      kind: "REVERSE_CHARGE_CONSENT",
      bytes: pdf,
      contentType: "application/pdf",
      extension: "pdf",
    });
    await db
      .update(reverseChargeConsents)
      .set({ archiveKey: key, archivedAt: new Date() })
      .where(eq(reverseChargeConsents.id, consent.id));
    return { ok: true, key };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
