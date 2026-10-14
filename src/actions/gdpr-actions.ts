"use server";

import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { users, invoices, accounts, outboundInvoices } from "@/db/schema";
import { eq, and, isNotNull, ne, sql } from "drizzle-orm";
import {
  BOOKKEEPING_RETENTION_YEARS,
  retentionExpiresAfterTaxYear,
} from "@/lib/documents/retention";
import bcrypt from "bcryptjs";
import { deleteFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import { getDictionary } from "@/lib/i18n/server";

/**
 * GDPR "right to erasure" with a 30-day grace period.
 *
 * Flow:
 *   1. User confirms via the two-step dialog (password + typing DELETE).
 *   2. `requestAccountDeletion` stamps `deletion_requested_at` (now) and
 *      `deletion_scheduled_for` (now + 30d). The user row is NOT deleted —
 *      the user can still sign in, but the app shows a persistent warning
 *      banner and offers a "Cancel deletion" button everywhere.
 *   3. At any time before the scheduled date, `cancelAccountDeletion`
 *      clears both columns.
 *   4. A cron job at `/api/cron/purge-scheduled-deletions` runs daily and
 *      is the ONLY writer that actually removes user rows (and their S3
 *      files). Everything else is cascade-handled by the FK constraints.
 *
 * Erasure is split, because bookkeeping law outlives it. Deleting the user row
 * cascades to their issued invoices, receipts, signatures and SHAAM
 * submissions — records Israeli law requires the business to keep for seven
 * years. So `purgeUserNow` erases the identity immediately and defers
 * destroying the documents until retention expires. See
 * `src/lib/documents/retention.ts`.
 */

const GRACE_PERIOD_DAYS = 30;

export type RequestDeletionResult =
  | { ok: true; scheduledFor: Date }
  | {
      ok: false;
      code:
        | "unauthorized"
        | "invalid_password"
        | "invalid_confirmation"
        | "already_scheduled"
        | "failed";
      error: string;
    };

export async function requestAccountDeletion(
  formData: FormData
): Promise<RequestDeletionResult> {
  const dict = await getDictionary();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, code: "unauthorized", error: dict.errors.mustBeSignedIn };
  }

  const password = (formData.get("password") as string | null) ?? "";
  const confirmation = (formData.get("confirmation") as string | null) ?? "";

  if (confirmation !== "DELETE") {
    return {
      ok: false,
      code: "invalid_confirmation",
      error: 'Type "DELETE" exactly to confirm.',
    };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      passwordHash: true,
      deletionRequestedAt: true,
    },
  });

  if (!user) {
    return { ok: false, code: "unauthorized", error: dict.errors.accountNotFound };
  }

  if (user.deletionRequestedAt) {
    return {
      ok: false,
      code: "already_scheduled",
      error: dict.errors.deletionAlreadyScheduled,
    };
  }

  if (user.passwordHash) {
    if (!password) {
      return {
        ok: false,
        code: "invalid_password",
        error: dict.errors.enterPasswordToContinue,
      };
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return {
        ok: false,
        code: "invalid_password",
        error: dict.errors.passwordIncorrect,
      };
    }
  } else {
    // OAuth-only user — verify at least one provider link exists so we know
    // the session actually belongs to this user.
    const linked = await db.query.accounts.findFirst({
      where: eq(accounts.userId, userId),
      columns: { id: true },
    });
    if (!linked) {
      return {
        ok: false,
        code: "unauthorized",
        error: dict.errors.cannotVerifyOwnership,
      };
    }
  }

  const now = new Date();
  const scheduledFor = new Date(
    now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );

  try {
    await db
      .update(users)
      .set({
        deletionRequestedAt: now,
        deletionScheduledFor: scheduledFor,
      })
      .where(eq(users.id, userId));
  } catch (err) {
    console.error("[gdpr] Failed to schedule deletion", err);
    return {
      ok: false,
      code: "failed",
      error: dict.errors.deletionScheduleFailed,
    };
  }

  return { ok: true, scheduledFor };
}

export type CancelDeletionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function cancelAccountDeletion(): Promise<CancelDeletionResult> {
  const dict = await getDictionary();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, error: dict.errors.mustBeSignedIn };
  }

  try {
    await db
      .update(users)
      .set({ deletionRequestedAt: null, deletionScheduledFor: null })
      .where(eq(users.id, userId));
    return { ok: true };
  } catch (err) {
    console.error("[gdpr] Failed to cancel deletion", err);
    return { ok: false, error: dict.errors.deletionCancelFailed };
  }
}

export type DeletionStatus =
  | { requested: false }
  | {
      requested: true;
      requestedAt: Date;
      scheduledFor: Date;
      daysRemaining: number;
    };

export async function getDeletionStatus(): Promise<DeletionStatus> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { requested: false };

  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { deletionRequestedAt: true, deletionScheduledFor: true },
  });

  if (!row?.deletionRequestedAt || !row.deletionScheduledFor) {
    return { requested: false };
  }

  const msRemaining = row.deletionScheduledFor.getTime() - Date.now();
  const daysRemaining = Math.max(
    0,
    Math.ceil(msRemaining / (1000 * 60 * 60 * 24))
  );

  return {
    requested: true,
    requestedAt: row.deletionRequestedAt,
    scheduledFor: row.deletionScheduledFor,
    daysRemaining,
  };
}

/**
 * Hard-delete a single user. Used by:
 *   * The scheduled purge cron for users whose grace period has elapsed.
 *
 * Best-effort deletes all S3 objects referenced by the user's invoices
 * (orphans in S3 are safer than blocking the DB delete); then removes the
 * user row and relies on FK cascades for everything else. The audit_log
 * table uses ON DELETE SET NULL so its rows survive anonymized.
 *
 * NOT exported as a server action on purpose — callers that legitimately
 * need it (the cron) import the function directly.
 */
/**
 * The latest tax year for which this user holds records that bookkeeping law
 * requires keeping, or null when they hold none.
 *
 * Two sources count: the business's own issued documents (anything past
 * `draft`, including `voided` — a voided document is still part of the audit
 * trail), and inbound invoices, which are the expense documentation behind the
 * same books. Inbound rows without an invoice date fall back to when they were
 * captured, which is the conservative choice: it can only extend retention.
 */
async function latestStatutoryTaxYear(userId: string): Promise<number | null> {
  const [outbound] = await db
    .select({ maxTaxYear: sql<number | null>`max(${outboundInvoices.taxYear})` })
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.userId, userId),
        ne(outboundInvoices.status, "draft"),
      ),
    );

  const [inbound] = await db
    .select({
      maxTaxYear: sql<number | null>`max(extract(year from coalesce(${invoices.invoiceDate}, ${invoices.createdAt})))`,
    })
    .from(invoices)
    .where(eq(invoices.userId, userId));

  const years = [outbound?.maxTaxYear, inbound?.maxTaxYear]
    .map((y) => (y == null ? null : Number(y)))
    .filter((y): y is number => y != null && Number.isFinite(y));

  return years.length > 0 ? Math.max(...years) : null;
}

/**
 * Strip every identifying field from the account while leaving the documents
 * intact. The row has to survive because the records hang off it by foreign
 * key, but nothing on it should still point at a person.
 *
 * `email` is unique and NOT NULL, so it becomes a per-user tombstone on the
 * reserved `.invalid` TLD, which can never receive mail.
 */
async function anonymiseUser(userId: string, retainUntil: Date): Promise<void> {
  await db
    .update(users)
    .set({
      email: `deleted-${userId}@deleted.invalid`,
      name: null,
      companyName: null,
      passwordHash: null,
      image: null,
      emailVerified: null,
      displayCurrency: null,
      preferredLocale: null,
      // Keep the request timestamp — it is the evidence that erasure was asked
      // for — and move the schedule out to the end of the retention window so
      // the same cron finishes the job then.
      deletionScheduledFor: retainUntil,
    })
    .where(eq(users.id, userId));

  // Federated sign-in links are identifying in themselves.
  await db.delete(accounts).where(eq(accounts.userId, userId));
}

export type PurgeOutcome =
  /** User row and files gone. */
  | "purged"
  /** Identity erased; documents kept until `retainedUntil`. */
  | "anonymised_pending_retention"
  | "failed";

export async function purgeUserNow(
  userId: string,
  now: Date = new Date(),
): Promise<{
  outcome: PurgeOutcome;
  deletedFiles: number;
  deletedUserRow: boolean;
  retainedUntil?: Date;
}> {
  // Decide first, because a hard delete is unrecoverable and the files are the
  // records themselves.
  let latestTaxYear: number | null = null;
  try {
    latestTaxYear = await latestStatutoryTaxYear(userId);
  } catch (err) {
    // Never destroy records because a retention check failed.
    console.error("[gdpr] Retention check failed; refusing to purge", userId, err);
    return { outcome: "failed", deletedFiles: 0, deletedUserRow: false };
  }

  if (latestTaxYear !== null) {
    const retainUntil = retentionExpiresAfterTaxYear(latestTaxYear);
    if (now < retainUntil) {
      try {
        await anonymiseUser(userId, retainUntil);
      } catch (err) {
        console.error("[gdpr] Failed to anonymise user", userId, err);
        return { outcome: "failed", deletedFiles: 0, deletedUserRow: false };
      }
      console.info(
        `[gdpr] Anonymised ${userId}; documents retained until ${retainUntil.toISOString()} ` +
          `(tax year ${latestTaxYear} + ${BOOKKEEPING_RETENTION_YEARS}y)`,
      );
      return {
        outcome: "anonymised_pending_retention",
        deletedFiles: 0,
        deletedUserRow: false,
        retainedUntil: retainUntil,
      };
    }
  }

  // Either the user holds no statutory records, or retention has expired.
  let deletedFiles = 0;

  try {
    const rows = await db
      .select({ fileUrl: invoices.fileUrl })
      .from(invoices)
      .where(and(eq(invoices.userId, userId), isNotNull(invoices.fileUrl)));

    for (const row of rows) {
      if (!row.fileUrl?.trim()) continue;
      const key = resolveStorageKeyFromFileUrl(row.fileUrl);
      if (!key) continue;
      try {
        await deleteFile(key);
        deletedFiles++;
      } catch (err) {
        console.error("[gdpr] Failed to delete S3 object", key, err);
      }
    }
  } catch (err) {
    console.error("[gdpr] Failed to enumerate invoice files", err);
  }

  try {
    await db.delete(users).where(eq(users.id, userId));
  } catch (err) {
    console.error("[gdpr] Failed to delete user row", userId, err);
    return { outcome: "failed", deletedFiles, deletedUserRow: false };
  }

  return { outcome: "purged", deletedFiles, deletedUserRow: true };
}

/**
 * Sign the current user out. Used by the client after a deletion request
 * succeeds — not strictly required (the user can keep using the app during
 * the grace period), but if they want to log out immediately we offer it.
 */
export async function signOutAfterRequest(): Promise<void> {
  await signOut({ redirect: false });
}
