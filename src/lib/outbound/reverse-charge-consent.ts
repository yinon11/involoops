/**
 * Buyer consent to a reverse charge (היפוך חיוב).
 *
 * ITA v2.0 spec §2.2.2: "Upon obtaining the customer's consent (in any way
 * agreed between the parties), the reverse charge action will be executed."
 * The spec says consent is required and leaves the mechanism to us. This
 * module is that mechanism: the seller sends the buyer a link, the buyer
 * reads exactly what they are agreeing to and signs it, and we keep the
 * evidence — see `reverse_charge_consents` for what is stored and why.
 *
 * Shared by both reverse-charge routes: a document issued as reverse charge
 * from the start, and one resolved by reverse charge after an ITA refusal.
 * Neither may proceed without a signed consent from `currentValidConsent`.
 *
 * **The consent and acknowledgement wording was reviewed and approved by
 * the accountant (2026-10).** It is versioned so it can change without
 * rewriting what earlier buyers signed.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { isValidIsraeliVatNumber } from "@/lib/uniform-structure/vat-checksum";
import {
  businessEntities,
  customers,
  outboundInvoices,
  reverseChargeConsents,
} from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { canonicalJson } from "@/lib/audit/canonical-json";
import { formatMoney } from "@/lib/money";
import { validatePayments, type PaymentEntry } from "@/lib/documents/payments";

/**
 * Bump on any change to `renderConsentText` / `sellerAcknowledgementText`.
 * A signed consent keeps the version, the exact text and its hash of what
 * its signer saw, so earlier consents stay provable after a rewording.
 *
 * 2026-10-v1 — the accountant's approved wording (adds "בדוקומנט זה").
 * The seller acknowledgement was approved as drafted, so it keeps its
 * version.
 */
export const CONSENT_TEXT_VERSION = "2026-10-v1";
export const SELLER_ACK_VERSION = "2026-09-v1";

/**
 * How long the link stays usable. The buyer is a third party with their own
 * schedule — often someone else in their finance team — so this is longer
 * than a team invite.
 */
export const CONSENT_TTL_DAYS = 14;

/** A drawn signature is a few KB; anything near this is not a signature. */
export const MAX_SIGNATURE_BYTES = 200_000;

/**
 * A tax invoice, or a tax invoice-receipt whose recorded payments already
 * equal the amount without VAT (see `paymentsMismatch`).
 */
export const REVERSE_CHARGE_DOCUMENT_TYPES = [
  "TAX_INVOICE",
  "TAX_INVOICE_RECEIPT",
] as const;

/**
 * For an invoice-receipt: do the recorded payments equal `total`? Returns
 * an explanation when they do not, null when they do (or for a document
 * type that carries no payments).
 */
export function paymentsMismatch(
  row: {
    documentType: string;
    payments: unknown;
    currency: string | null;
  },
  total: string | number,
): string | null {
  if (row.documentType !== "TAX_INVOICE_RECEIPT") return null;
  const err = validatePayments(
    (row.payments ?? []) as PaymentEntry[],
    "TAX_INVOICE_RECEIPT",
    Number(total),
    row.currency ?? "ILS",
  );
  if (!err) return null;
  if (err.code === "SUM_MISMATCH" && "actual" in err) {
    return `The payments recorded on this invoice-receipt total ${err.actual}; with reverse charge its total is ${err.expected}. Reverse charge needs an invoice-receipt whose payments equal the amount without VAT — create it with VAT off.`;
  }
  return err.message;
}

export type ConsentLocale = "he" | "en";

/**
 * The facts the buyer is agreeing to. Deliberately excludes everything the
 * reverse charge itself changes — VAT rate, VAT amount, total — and
 * everything issuing assigns later, such as the fiscal number. Otherwise
 * converting the draft to 0% VAT, or issuing it, would invalidate the very
 * consent that authorised doing so.
 */
export interface ConsentSnapshot {
  documentId: string;
  documentType: string;
  invoiceDate: string;
  currency: string;
  /** Pre-VAT amount, as a fixed two-decimal string. */
  subtotal: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  seller: { name: string; vatNumber: string | null };
  buyer: { name: string; taxId: string };
}

const BUYER_TAX_ID = /^\d{9}$/;

export function hashSnapshot(snapshot: ConsentSnapshot): string {
  return sha256(canonicalJson(snapshot));
}

export function hashToken(rawToken: string): string {
  return sha256(rawToken);
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/**
 * What the buyer reads and signs. Rendered from the stored snapshot, never
 * from the live invoice, so the text that is hashed at signing is exactly
 * the text that was on the screen.
 */
export function renderConsentText(
  locale: ConsentLocale,
  s: ConsentSnapshot,
): string {
  const amount = `${s.subtotal} ${s.currency}`;
  const sellerId = s.seller.vatNumber ? ` (${s.seller.vatNumber})` : "";
  if (locale === "he") {
    return [
      `בשם ${s.buyer.name} (מספר עוסק ${s.buyer.taxId}), אני מאשר/ת כי על העסקה המפורטת להלן, שסכומה לפני מע״מ ${amount}, יחול מנגנון היפוך חיוב (חיוב עצמי):`,
      `• ${s.seller.name}${sellerId} יפיק בגינה חשבונית בשיעור מע״מ אפס.`,
      `• ${s.buyer.name} אחראי/ת לדווח על העסקה ולשלם בעצמו/ה את מס העסקאות בגינה.`,
      `ידוע לי כי הסכמה זו חלה על פרטי העסקה המוצגים בדוקומנט זה בלבד, וכי כל שינוי בהם מחייב הסכמה חדשה.`,
    ].join("\n");
  }
  return [
    `On behalf of ${s.buyer.name} (VAT number ${s.buyer.taxId}), I agree that the transaction set out below, with a pre-VAT amount of ${amount}, is subject to the reverse-charge mechanism (self-assessment):`,
    `• ${s.seller.name}${sellerId} will issue the invoice for it at a zero VAT rate.`,
    `• ${s.buyer.name} is responsible for reporting the transaction and paying the output VAT on it themselves.`,
    `I understand this consent covers only the transaction details shown in this document, and that any change to them requires a new consent.`,
  ].join("\n");
}

/**
 * What the seller must confirm before a consent request can even be sent.
 * Reverse charge is a legal mechanism for specific transaction types, not a
 * general option, and deciding that it applies is the seller's call.
 */
export function sellerAcknowledgementText(locale: ConsentLocale): string {
  return locale === "he"
    ? "אני מאשר/ת כי העסקה עומדת בתנאים להחלת מנגנון היפוך חיוב לפי חוק מס ערך מוסף ותקנותיו, וכי האחריות לבחינת התנאים ולהחלת המנגנון מוטלת עליי כמוכר/ת. היפוך חיוב אינו חל על כל סוגי העסקאות."
    : "I confirm this transaction qualifies for the reverse-charge mechanism under the VAT Law and its regulations, and that responsibility for assessing this and applying it is mine as the seller. Reverse charge does not apply to every type of transaction.";
}

// ---------------------------------------------------------------------------
// Snapshot of the live document
// ---------------------------------------------------------------------------

type SnapshotResult =
  | {
      ok: true;
      snapshot: ConsentSnapshot;
      invoice: typeof outboundInvoices.$inferSelect;
      buyerEmail: string | null;
    }
  | { ok: false; error: string };

/**
 * Build the consent snapshot from the document as it is right now. Used both
 * to create a request and to check later whether a signed consent still
 * covers the document — the two must go through the same function or a
 * harmless difference in formatting would read as the document changing.
 */
export async function snapshotForDocument(
  documentId: string,
): Promise<SnapshotResult> {
  const [invoice] = await db
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, documentId))
    .limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found" };

  const [entity] = await db
    .select({
      legalName: businessEntities.legalName,
      osekMurshe: businessEntities.osekMurshe,
    })
    .from(businessEntities)
    .where(eq(businessEntities.id, invoice.businessEntityId))
    .limit(1);
  if (!entity) return { ok: false, error: "Business entity not found" };

  if (!invoice.customerId) {
    return { ok: false, error: "The invoice has no customer." };
  }
  const [customer] = await db
    .select({
      name: customers.name,
      taxId: customers.taxId,
      email: customers.email,
    })
    .from(customers)
    .where(eq(customers.id, invoice.customerId))
    .limit(1);
  if (!customer) return { ok: false, error: "Customer not found" };

  // A reverse charge moves the VAT liability to the buyer, who then reports
  // it themselves — which only a VAT-registered business (עוסק מורשה or a
  // company) can do. No valid 9-digit number, no reverse charge.
  //
  // This is a floor, not proof of status: an עוסק פטור's number passes the
  // same check digit. Whether the buyer is actually registered for VAT is
  // part of what the seller acknowledges.
  const taxId = customer.taxId?.trim() ?? "";
  if (!BUYER_TAX_ID.test(taxId) || !isValidIsraeliVatNumber(taxId)) {
    return {
      ok: false,
      error:
        "Reverse charge needs a buyer registered for VAT: the customer must have a valid 9-digit licensed-dealer or company number.",
    };
  }

  const snapshot: ConsentSnapshot = {
    documentId: invoice.id,
    documentType: invoice.documentType,
    invoiceDate: String(invoice.invoiceDate),
    currency: invoice.currency ?? "ILS",
    subtotal: money(invoice.subtotal),
    items: (invoice.items ?? []).map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      total: Number(i.total),
    })),
    seller: { name: entity.legalName, vatNumber: entity.osekMurshe ?? null },
    buyer: { name: customer.name, taxId },
  };
  return {
    ok: true,
    snapshot,
    invoice,
    buyerEmail: customer.email?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export async function createConsentRequest(params: {
  documentId: string;
  actorUserId: string;
  /** The seller ticked the responsibility box. Required, not assumed. */
  sellerAcknowledged: boolean;
  /** Overrides the customer's email on file, e.g. their finance contact. */
  recipientEmail?: string | null;
}): Promise<
  | {
      ok: true;
      consentId: string;
      rawToken: string;
      recipientEmail: string;
      expiresAt: Date;
      snapshot: ConsentSnapshot;
      /** The invoice's language — the consent link opens in it. */
      language: string | null;
    }
  | { ok: false; error: string }
> {
  if (params.sellerAcknowledged !== true) {
    return {
      ok: false,
      error:
        "Confirm that this transaction qualifies for reverse charge, and that this is your responsibility as the seller.",
    };
  }

  const snap = await snapshotForDocument(params.documentId);
  if (!snap.ok) return snap;
  const { snapshot, invoice } = snap;

  // Both routes run on a draft: route A before it is ever issued, route B on
  // a document the ITA refused, which stays in draft by design. An issued
  // document is a fiscal record and cannot be turned into something else by
  // collecting a signature.
  if (invoice.status !== "draft") {
    return {
      ok: false,
      error: "Reverse-charge consent can only be requested on a draft invoice.",
    };
  }
  if (
    !(REVERSE_CHARGE_DOCUMENT_TYPES as readonly string[]).includes(
      invoice.documentType,
    )
  ) {
    return {
      ok: false,
      error:
        "Reverse charge is available on a tax invoice or a tax invoice-receipt only.",
    };
  }
  const mismatch = paymentsMismatch(invoice, invoice.subtotal);
  if (mismatch) return { ok: false, error: mismatch };

  const recipient = (params.recipientEmail?.trim() || snap.buyerEmail || "")
    .toLowerCase();
  if (!recipient || !recipient.includes("@")) {
    return {
      ok: false,
      error: "The customer has no email address to send the consent link to.",
    };
  }

  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONSENT_TTL_DAYS * 86_400_000);

  const consentId = await db.transaction(async (tx) => {
    // One live request per document. A new request — to a different
    // contact, or after the seller edited the draft — supersedes the old
    // link rather than leaving two valid ones in circulation.
    await tx
      .update(reverseChargeConsents)
      .set({ status: "revoked", revokedAt: now })
      .where(
        and(
          eq(reverseChargeConsents.documentId, invoice.id),
          eq(reverseChargeConsents.status, "pending"),
        ),
      );

    const [row] = await tx
      .insert(reverseChargeConsents)
      .values({
        documentId: invoice.id,
        businessEntityId: invoice.businessEntityId,
        customerId: invoice.customerId,
        status: "pending",
        requestedByUserId: params.actorUserId,
        requestedAt: now,
        recipientEmail: recipient,
        tokenHash: hashToken(rawToken),
        expiresAt,
        sellerAcknowledgedAt: now,
        sellerAcknowledgementVersion: SELLER_ACK_VERSION,
        documentSnapshot: snapshot as unknown as Record<string, unknown>,
        documentSnapshotHash: hashSnapshot(snapshot),
        consentTextVersion: CONSENT_TEXT_VERSION,
      })
      .returning({ id: reverseChargeConsents.id });

    await appendAuditEntry({
      tx,
      businessEntityId: invoice.businessEntityId,
      userId: invoice.userId,
      documentId: invoice.id,
      documentType: invoice.documentType,
      eventType: "REVERSE_CHARGE_CONSENT_REQUESTED",
      eventPayload: {
        consentId: row.id,
        recipientEmail: recipient,
        expiresAt: expiresAt.toISOString(),
        documentSnapshotHash: hashSnapshot(snapshot),
        consentTextVersion: CONSENT_TEXT_VERSION,
        sellerAcknowledgementVersion: SELLER_ACK_VERSION,
      },
      actor: { userId: params.actorUserId },
    });

    // §2.2.2's promise is kept here, not behind a second click: asking the
    // buyer to sign IS choosing reverse charge, so the draft flips to zero
    // VAT at once. This cannot produce an unsigned zero-VAT document —
    // issuing re-checks for a signed consent that covers the draft
    // (`reverseChargeIssueCheck`) and stays blocked until it exists. The
    // snapshot hashed above deliberately excludes VAT and total, so the
    // flip does not invalidate the consent just created.
    if (!invoice.reverseCharge) {
      await tx
        .update(outboundInvoices)
        .set({
          reverseCharge: true,
          reverseChargeConsentId: row.id,
          vatRate: "0.00",
          vatAmount: "0.00",
          total: formatMoney(invoice.subtotal),
          version: sql`${outboundInvoices.version} + 1`,
          updatedAt: now,
        })
        .where(eq(outboundInvoices.id, invoice.id));
      await appendAuditEntry({
        tx,
        businessEntityId: invoice.businessEntityId,
        userId: invoice.userId,
        documentId: invoice.id,
        documentType: invoice.documentType,
        eventType: "REVERSE_CHARGE_APPLIED",
        eventPayload: {
          consentId: row.id,
          reason: "on_consent_request",
          before: {
            vatRate: invoice.vatRate,
            vatAmount: invoice.vatAmount,
            total: invoice.total,
          },
          after: {
            vatRate: "0.00",
            vatAmount: "0.00",
            total: formatMoney(invoice.subtotal),
          },
        },
        actor: { userId: params.actorUserId },
      });
    } else {
      // Already converted (a re-request): just point the document at the
      // consent it is now waiting on.
      await tx
        .update(outboundInvoices)
        .set({ reverseChargeConsentId: row.id, updatedAt: now })
        .where(eq(outboundInvoices.id, invoice.id));
    }

    return row.id;
  });

  return {
    ok: true,
    consentId,
    rawToken,
    recipientEmail: recipient,
    expiresAt,
    snapshot,
    language: invoice.language ?? null,
  };
}

// ---------------------------------------------------------------------------
// The buyer's side
// ---------------------------------------------------------------------------

export type ConsentState =
  | "pending"
  | "expired"
  | "signed"
  | "revoked"
  /** The invoice changed after the request was sent. */
  | "stale";

export interface ConsentView {
  state: ConsentState;
  consent: typeof reverseChargeConsents.$inferSelect;
  snapshot: ConsentSnapshot;
}

/**
 * Resolve a link token to the consent it belongs to, and say what state it
 * is in. Returns null for an unknown token — the page must not distinguish
 * "never existed" from anything else.
 */
export async function findConsentByToken(
  rawToken: string,
): Promise<ConsentView | null> {
  if (!rawToken || rawToken.length > 200) return null;
  const [consent] = await db
    .select()
    .from(reverseChargeConsents)
    .where(eq(reverseChargeConsents.tokenHash, hashToken(rawToken)))
    .limit(1);
  if (!consent) return null;

  const snapshot = consent.documentSnapshot as unknown as ConsentSnapshot;
  return { state: await stateOf(consent), consent, snapshot };
}

async function stateOf(
  consent: typeof reverseChargeConsents.$inferSelect,
): Promise<ConsentState> {
  if (consent.status === "signed") return "signed";
  if (consent.status === "revoked") return "revoked";
  if (consent.expiresAt.getTime() <= Date.now()) return "expired";
  // Still pending: is it still about the same document? The seller can edit
  // a draft after sending the link, and the buyer must not sign facts that
  // are no longer the facts.
  const live = await snapshotForDocument(consent.documentId);
  if (!live.ok || hashSnapshot(live.snapshot) !== consent.documentSnapshotHash) {
    return "stale";
  }
  return "pending";
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

export async function signConsent(params: {
  rawToken: string;
  signerName: string;
  signerRole?: string | null;
  signaturePng: string;
  locale: ConsentLocale;
  ip: string;
  userAgent: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; state?: ConsentState }> {
  const view = await findConsentByToken(params.rawToken);
  if (!view) return { ok: false, error: "This link is not valid." };
  if (view.state !== "pending") {
    return { ok: false, error: "This consent can no longer be signed.", state: view.state };
  }

  const signerName = params.signerName.trim();
  if (signerName.length < 2 || signerName.length > 200) {
    return { ok: false, error: "Enter your full name." };
  }
  const signerRole = params.signerRole?.trim().slice(0, 200) || null;

  if (
    !PNG_DATA_URL.test(params.signaturePng) ||
    params.signaturePng.length > MAX_SIGNATURE_BYTES
  ) {
    return { ok: false, error: "Draw your signature in the box." };
  }

  const text = renderConsentText(params.locale, view.snapshot);
  const now = new Date();
  const { consent } = view;

  const signed = await db.transaction(async (tx) => {
    // Conditional on still being pending: two tabs, or a double submit,
    // must produce one signature, not two.
    const [row] = await tx
      .update(reverseChargeConsents)
      .set({
        status: "signed",
        signedAt: now,
        signerName,
        signerRole,
        consentLocale: params.locale,
        consentTextHash: sha256(text),
        consentText: text,
        signaturePng: params.signaturePng,
        signerIp: params.ip.slice(0, 64),
        signerUserAgent: params.userAgent?.slice(0, 1000) ?? null,
      })
      .where(
        and(
          eq(reverseChargeConsents.id, consent.id),
          eq(reverseChargeConsents.status, "pending"),
        ),
      )
      .returning({ id: reverseChargeConsents.id });
    if (!row) return false;

    const [invoice] = await tx
      .select({
        userId: outboundInvoices.userId,
        documentType: outboundInvoices.documentType,
      })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.id, consent.documentId))
      .limit(1);
    // Cannot happen — the consent row cascades with its invoice — but if it
    // ever did, failing loudly beats writing an audit row with an invented
    // actor. Throwing rolls the signature back with it.
    if (!invoice) throw new Error("consent's invoice vanished mid-signature");

    await appendAuditEntry({
      tx,
      businessEntityId: consent.businessEntityId,
      userId: invoice.userId,
      documentId: consent.documentId,
      documentType: invoice.documentType,
      eventType: "REVERSE_CHARGE_CONSENT_SIGNED",
      eventPayload: {
        consentId: consent.id,
        // The signer is the buyer, an outside party with no user account.
        // `actor` below has to name a user, so it names the document owner;
        // who actually signed, and from where, is recorded here.
        signedBy: "buyer",
        signerName,
        signerRole,
        signerIp: params.ip,
        consentLocale: params.locale,
        consentTextVersion: consent.consentTextVersion,
        consentTextHash: sha256(text),
        documentSnapshotHash: consent.documentSnapshotHash,
        signatureSha256: sha256(params.signaturePng),
      },
      actor: {
        userId: invoice.userId,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });
    return true;
  });

  return signed
    ? { ok: true }
    : { ok: false, error: "This consent was already signed.", state: "signed" };
}

// ---------------------------------------------------------------------------
// The gate both reverse-charge routes use
// ---------------------------------------------------------------------------

/**
 * The signed consent that covers the document **as it is now**, or null.
 *
 * Never trust `status === "signed"` alone: a draft can be edited after the
 * buyer signed, and the signature covers what they were shown, not what the
 * invoice later became.
 */
export async function currentValidConsent(
  documentId: string,
  /**
   * Route B: the consent was signed on the refused original, and the
   * invoice actually being issued is its replacement. The signature is
   * checked against the replacement's facts, under the original's id.
   */
  factsFromDocumentId: string = documentId,
): Promise<typeof reverseChargeConsents.$inferSelect | null> {
  const [latest] = await db
    .select()
    .from(reverseChargeConsents)
    .where(
      and(
        eq(reverseChargeConsents.documentId, documentId),
        eq(reverseChargeConsents.status, "signed"),
      ),
    )
    .orderBy(desc(reverseChargeConsents.signedAt))
    .limit(1);
  if (!latest) return null;

  const live = await snapshotForDocument(factsFromDocumentId);
  if (!live.ok) return null;
  return hashSnapshot({ ...live.snapshot, documentId }) === latest.documentSnapshotHash
    ? latest
    : null;
}

/** The newest consent row for a document, in any state, for the seller's UI. */
export async function latestConsentFor(
  documentId: string,
  /** Route B: judge staleness against the replacement's facts. */
  factsFromDocumentId: string = documentId,
): Promise<{
  state: ConsentState;
  consent: typeof reverseChargeConsents.$inferSelect;
} | null> {
  const [latest] = await db
    .select()
    .from(reverseChargeConsents)
    .where(eq(reverseChargeConsents.documentId, documentId))
    .orderBy(desc(reverseChargeConsents.createdAt))
    .limit(1);
  if (!latest) return null;

  // Signed is final for the buyer, but not for the seller: if the draft was
  // edited after signing, the signature covers the old facts and the seller
  // needs to know to ask again — `currentValidConsent` will refuse it.
  const state = await stateOf(latest);
  if (state === "signed") {
    const live = await snapshotForDocument(factsFromDocumentId);
    if (
      !live.ok ||
      hashSnapshot({ ...live.snapshot, documentId }) !== latest.documentSnapshotHash
    ) {
      return { state: "stale", consent: latest };
    }
  }
  return { state, consent: latest };
}
