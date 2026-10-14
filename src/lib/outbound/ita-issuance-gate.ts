/**
 * Issuance gate.
 *
 * Until the Israel Tax Authority approves this software (Form 513), only
 * platform admins may issue outbound documents. Drafts stay open for every
 * account. Set `ITA_ISSUANCE_APPROVED=1` after approval.
 *
 * The sandbox stack (`SIGNING_ENVIRONMENT=sandbox`, forced by the sandbox
 * Compose file and refused at boot if it holds a production signing key)
 * may issue. That does not open production.
 */
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isUserAdmin } from "@/lib/is-user-admin";

export const OUTBOUND_DOCUMENTS_LOCKED_MESSAGE =
  "This document cannot be issued until Israel Tax Authority approval. The draft is saved.";

export class OutboundDocumentsLockedError extends Error {
  constructor() {
    super(OUTBOUND_DOCUMENTS_LOCKED_MESSAGE);
    this.name = "OutboundDocumentsLockedError";
  }
}

export function itaIssuanceApproved(): boolean {
  return process.env.ITA_ISSUANCE_APPROVED === "1";
}

/**
 * Accounts allowed to issue before approval, without granting `isAdmin` — a
 * reviewer or a pilot account. Comma-separated in `ITA_ISSUANCE_ALLOW_EMAILS`.
 *
 * Deliberately configuration-only: no hardcoded allowlist. An address compiled
 * into the source is a standing privilege grant on every deployment of it,
 * including ones whose operator does not control that address — whoever
 * registers it there could issue tax documents from that business. The
 * allowlist belongs in the deployment's own configuration, where its operator
 * can see it.
 */
function issuanceAllowlist(): Set<string> {
  return new Set(
    (process.env.ITA_ISSUANCE_ALLOW_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function canIssueOutboundDocument(
  userId: string,
): Promise<boolean> {
  if ((process.env.SIGNING_ENVIRONMENT ?? "").trim() === "sandbox") return true;
  if (itaIssuanceApproved()) return true;
  if (await isUserAdmin(userId)) return true;

  const allow = issuanceAllowlist();
  if (allow.size === 0) return false;
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true },
  });
  const email = row?.email?.trim().toLowerCase();
  return email != null && allow.has(email);
}
