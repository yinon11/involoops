"use server";

import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { SUPPORTED_DISPLAY_CURRENCIES } from "@/lib/fx";
import { requireActorUserId as requireUserId } from "@/lib/team/enforce";
import { getDictionary } from "@/lib/i18n/server";

const displayCurrencySchema = z.object({
  displayCurrency: z.enum(SUPPORTED_DISPLAY_CURRENCIES),
});

/**
 * Set the signed-in user's preferred dashboard display currency.
 * Pass `null` via the client to clear the preference and fall back to the
 * env default / USD.
 */
export async function updateDisplayCurrencyAction(
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_settings");

  const parsed = displayCurrencySchema.safeParse({
    displayCurrency: code.toUpperCase(),
  });
  if (!parsed.success) {
    return { ok: false, error: dict.errors.unsupportedCurrency };
  }

  await db
    .update(users)
    .set({ displayCurrency: parsed.data.displayCurrency })
    .where(eq(users.id, userId));

  // Both overviews read this preference for every figure they render.
  // /dashboard, /income and /profit are redirect aliases now — revalidating
  // one refreshes a redirect, not the page that renders the data.
  revalidatePath("/money-out");
  revalidatePath("/money-in");
  revalidatePath("/");
  revalidatePath("/settings");

  return { ok: true };
}

/**
 * Hard cap matches the `users.company_name` varchar(255) column. We trim
 * incoming whitespace and treat empty/whitespace-only input as a request
 * to clear the field (stored as NULL).
 */
const COMPANY_NAME_MAX_CHARS = 255;
const companyNameSchema = z.object({
  companyName: z.string().max(COMPANY_NAME_MAX_CHARS).optional(),
});

/**
 * Set the signed-in user's business / company name. This is what the user
 * tells us their own business is called — it appears on their letterhead
 * and is used as a NEGATIVE filter during invoice extraction so the LLM
 * never picks the user's own name as the vendor on an uploaded bill (see
 * `src/lib/extraction/pipeline.ts#collectOwnBusinessNames`).
 *
 * Until the redesign, this is the only end-user-accessible setter for
 * `users.companyName` outside the Stripe checkout prefill.
 */
export async function updateCompanyNameAction(
  rawCompanyName: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dict = await getDictionary();
  const userId = await requireUserId("manage_settings");

  const parsed = companyNameSchema.safeParse({
    companyName: rawCompanyName ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: dict.errors.businessNameTooLong };
  }

  const trimmed = parsed.data.companyName?.trim() ?? "";
  const valueToStore = trimmed.length === 0 ? null : trimmed;

  await db
    .update(users)
    .set({ companyName: valueToStore })
    .where(eq(users.id, userId));

  revalidatePath("/settings");
  revalidatePath("/money-out");

  return { ok: true };
}

/**
 * Toggle the per-user override for auto-act-as on sign-in. When `enabled`
 * is false the manager stays on their own account on sign-in even if their
 * single linked managed account has `auto_act_as = true`.
 */
export async function updateAutoActAsManagedAccountsAction(
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId("manage_settings");

  await db
    .update(users)
    .set({ autoActAsManagedAccounts: enabled })
    .where(eq(users.id, userId));

  revalidatePath("/settings");

  return { ok: true };
}

/**
 * Toggle the post-approve "auto-approve this vendor?" prompt. When `suppress`
 * is true the dialog never shows again until the user re-enables it from
 * Settings → Invoices.
 */
export async function updateAutoApprovePromptPreferenceAction(
  suppress: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId("manage_settings");

  await db
    .update(users)
    .set({ suppressAutoApprovePrompt: suppress })
    .where(eq(users.id, userId));

  revalidatePath("/settings");
  revalidatePath("/pending");

  return { ok: true };
}
