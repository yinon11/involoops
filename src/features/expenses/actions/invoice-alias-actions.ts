"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateAliasCandidate } from "@/lib/gmail/alias";
import { getDictionary } from "@/lib/i18n/server";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

/**
 * Idempotently claim the signed-in user's forwarding alias. If one is
 * already set, returns it unchanged; otherwise generates a fresh random
 * alias, persists it, and returns it.
 *
 * Uniqueness is enforced by the partial UNIQUE index on
 * `users.invoice_alias` (migration 0014). On the rare chance of a
 * collision we retry with a fresh candidate; after MAX_ATTEMPTS we give
 * up — the adjective × animal × number keyspace is ~38 × 36 × 990 ≈ 1.3M,
 * so collisions during retry are astronomically unlikely unless the table
 * is huge, at which point the right fix is to widen the number range, not
 * keep looping forever.
 */
const MAX_ATTEMPTS = 8;

export async function claimInvoiceAliasAction(): Promise<
  | { ok: true; alias: string; alreadyExisted: boolean }
  | { ok: false; error: string }
> {
  const dict = await getDictionary();
  const userId = await requireUserId();

  const existing = await db
    .select({ alias: users.invoiceAlias })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing[0]?.alias) {
    return { ok: true, alias: existing[0].alias, alreadyExisted: true };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateAliasCandidate();
    try {
      const updated = await db
        .update(users)
        .set({ invoiceAlias: candidate })
        // Only write if still NULL — guards against a concurrent claim by
        // the same user (two tabs) so we don't overwrite a valid alias.
        .where(and(eq(users.id, userId), isNull(users.invoiceAlias)))
        .returning({ alias: users.invoiceAlias });

      if (updated[0]?.alias) {
        revalidatePath("/settings");
        revalidatePath("/invoices/upload");
        return { ok: true, alias: updated[0].alias, alreadyExisted: false };
      }

      // Zero rows updated — another tab claimed first. Re-read and return.
      const reread = await db
        .select({ alias: users.invoiceAlias })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (reread[0]?.alias) {
        return { ok: true, alias: reread[0].alias, alreadyExisted: true };
      }
    } catch (err) {
      // Partial UNIQUE index violation (Postgres code 23505) means this
      // candidate is taken by another user — retry with a new one. Any
      // other error bubbles up as a generic failure.
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : null;
      if (code !== "23505") {
        console.error("[claimInvoiceAliasAction] unexpected error:", err);
        return { ok: false, error: dict.errors.aliasClaimFailed };
      }
    }
  }

  return {
    ok: false,
    error: dict.errors.aliasesExhausted,
  };
}
