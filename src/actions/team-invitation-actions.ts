"use server";

import crypto from "crypto";
import { z } from "zod";
import { and, desc, eq, isNull, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  accountInvitations,
  accountLinks,
  users,
} from "@/db/schema";
import { sendTeamInvitationEmail } from "@/lib/email/team-invite";
import { sanitizeCapabilities } from "@/lib/team/capabilities";
import { getDictionary } from "@/lib/i18n/server";

const INVITATION_TTL_DAYS = 7;
const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type ActionResult<T = unknown> = Ok<T> | Err;

const createSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .transform((v) => v.toLowerCase().trim()),
  capabilities: z.array(z.string()).default([]),
});

async function requireSession() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  // Sub-users acting-as the owner (originator set) cannot manage the team —
  // only the actual owner of the account is allowed to grant access.
  if (session?.user?.originator) return null;
  return { userId, locale: session.user.preferredLocale ?? null };
}

/**
 * Create or refresh a team invitation. Owner-only.
 *
 * Refresh semantics: if a non-revoked, unaccepted invitation already exists
 * for the same email + owner, we replace it (rotates the token). This makes
 * "resend" idempotent without requiring a separate action.
 */
export async function createTeamInvitation(
  formData: FormData,
): Promise<ActionResult<{ invitationId: string }>> {
  const dict = await getDictionary();
  const me = await requireSession();
  if (!me) return { ok: false, error: dict.errors.notSignedIn };

  const raw = {
    email: (formData.get("email") as string) ?? "",
    capabilities: formData.getAll("capabilities").map((v) => String(v)),
  };
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const capabilities = sanitizeCapabilities(parsed.data.capabilities);
  const { email } = parsed.data;

  const ownerRow = await db.query.users.findFirst({
    where: eq(users.id, me.userId),
    columns: { name: true, email: true, preferredLocale: true },
  });
  if (!ownerRow) return { ok: false, error: dict.errors.ownerNotFound };

  if (email === ownerRow.email.toLowerCase()) {
    return { ok: false, error: dict.errors.cannotInviteYourself };
  }

  // If the invitee already has a user account that is already linked, no-op.
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (existingUser) {
    const existingLink = await db.query.accountLinks.findFirst({
      where: and(
        eq(accountLinks.managerUserId, existingUser.id),
        eq(accountLinks.managedUserId, me.userId),
      ),
    });
    if (existingLink) {
      return { ok: false, error: dict.errors.alreadyOnTeam };
    }
  }

  await db
    .delete(accountInvitations)
    .where(
      and(
        eq(accountInvitations.ownerUserId, me.userId),
        eq(accountInvitations.email, email),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.revokedAt),
      ),
    );

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const [row] = await db
    .insert(accountInvitations)
    .values({
      ownerUserId: me.userId,
      email,
      token,
      capabilities,
      expiresAt,
    })
    .returning({ id: accountInvitations.id });

  const sent = await sendTeamInvitationEmail({
    to: email,
    token,
    inviterName: ownerRow.name ?? "",
    inviterEmail: ownerRow.email,
    expiresAt,
    locale: ownerRow.preferredLocale ?? me.locale,
  });

  if (!sent.ok) {
    // The DB row stays so the owner can copy the link manually if email is
    // unconfigured locally; surface the error so they know.
    revalidatePath("/settings");
    return { ok: false, error: sent.error };
  }

  revalidatePath("/settings");
  return { ok: true, invitationId: row.id };
}

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Re-send the invitation email for an existing pending invite. Owner-only.
 *
 * Keeps the same token (any link already delivered stays valid) but refreshes
 * the expiry window so the recipient gets the full TTL from "now".
 */
export async function resendTeamInvitation(
  invitationId: string,
): Promise<ActionResult> {
  const dict = await getDictionary();
  const me = await requireSession();
  if (!me) return { ok: false, error: dict.errors.notSignedIn };
  const parsed = idSchema.safeParse({ id: invitationId });
  if (!parsed.success) return { ok: false, error: dict.errors.invalidInvitationId };

  const invite = await db.query.accountInvitations.findFirst({
    where: and(
      eq(accountInvitations.id, parsed.data.id),
      eq(accountInvitations.ownerUserId, me.userId),
      isNull(accountInvitations.acceptedAt),
      isNull(accountInvitations.revokedAt),
    ),
  });
  if (!invite) {
    return { ok: false, error: dict.errors.invitationNotPending };
  }

  const ownerRow = await db.query.users.findFirst({
    where: eq(users.id, me.userId),
    columns: { name: true, email: true, preferredLocale: true },
  });
  if (!ownerRow) return { ok: false, error: dict.errors.ownerNotFound };

  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await db
    .update(accountInvitations)
    .set({ expiresAt })
    .where(eq(accountInvitations.id, invite.id));

  const sent = await sendTeamInvitationEmail({
    to: invite.email,
    token: invite.token,
    inviterName: ownerRow.name ?? "",
    inviterEmail: ownerRow.email,
    expiresAt,
    locale: ownerRow.preferredLocale ?? me.locale,
  });

  if (!sent.ok) {
    return { ok: false, error: sent.error };
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function revokeTeamInvitation(
  invitationId: string,
): Promise<ActionResult> {
  const dict = await getDictionary();
  const me = await requireSession();
  if (!me) return { ok: false, error: dict.errors.notSignedIn };
  const parsed = idSchema.safeParse({ id: invitationId });
  if (!parsed.success) return { ok: false, error: dict.errors.invalidInvitationId };

  await db
    .update(accountInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accountInvitations.id, parsed.data.id),
        eq(accountInvitations.ownerUserId, me.userId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true };
}

const updateSchema = z.object({
  linkId: z.string().uuid(),
  capabilities: z.array(z.string()).default([]),
});

export async function updateTeamMemberCapabilities(
  linkId: string,
  capabilities: string[],
): Promise<ActionResult> {
  const dict = await getDictionary();
  const me = await requireSession();
  if (!me) return { ok: false, error: dict.errors.notSignedIn };
  const parsed = updateSchema.safeParse({ linkId, capabilities });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const sanitized = sanitizeCapabilities(parsed.data.capabilities);

  await db
    .update(accountLinks)
    .set({ capabilities: sanitized })
    .where(
      and(
        eq(accountLinks.id, parsed.data.linkId),
        eq(accountLinks.managedUserId, me.userId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true };
}

const autoActAsSchema = z.object({
  linkId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * Toggle the per-member "auto-act-as on sign-in" flag. Owner-only.
 *
 * When enabled (default) and the sub-user has exactly one linked owner,
 * the entry-session resolver switches them into the owner's account
 * automatically on sign-in.
 */
export async function updateTeamMemberAutoActAs(
  linkId: string,
  enabled: boolean,
): Promise<ActionResult> {
  const dict = await getDictionary();
  const me = await requireSession();
  if (!me) return { ok: false, error: dict.errors.notSignedIn };
  const parsed = autoActAsSchema.safeParse({ linkId, enabled });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  await db
    .update(accountLinks)
    .set({ autoActAs: parsed.data.enabled })
    .where(
      and(
        eq(accountLinks.id, parsed.data.linkId),
        eq(accountLinks.managedUserId, me.userId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeTeamMember(
  linkId: string,
): Promise<ActionResult> {
  const dict = await getDictionary();
  const me = await requireSession();
  if (!me) return { ok: false, error: dict.errors.notSignedIn };
  const parsed = idSchema.safeParse({ id: linkId });
  if (!parsed.success) return { ok: false, error: dict.errors.invalidId };
  await db
    .delete(accountLinks)
    .where(
      and(
        eq(accountLinks.id, parsed.data.id),
        eq(accountLinks.managedUserId, me.userId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Look up an invitation by its public token. Returns the metadata callers
 * need to render the accept page; never exposes the owner's id directly.
 */
export async function lookupInvitationByToken(token: string) {
  if (typeof token !== "string" || token.length === 0) return null;
  const row = await db.query.accountInvitations.findFirst({
    where: eq(accountInvitations.token, token),
  });
  if (!row) return null;
  if (row.revokedAt) return { ...row, status: "revoked" as const };
  if (row.acceptedAt) return { ...row, status: "accepted" as const };
  if (row.expiresAt.getTime() < Date.now()) {
    return { ...row, status: "expired" as const };
  }
  const owner = await db.query.users.findFirst({
    where: eq(users.id, row.ownerUserId),
    columns: { name: true, email: true, companyName: true },
  });
  return { ...row, status: "pending" as const, owner };
}

/**
 * Accept the invitation: requires a signed-in user whose email matches the
 * invite. Creates the (manager → managed) link with the saved capabilities
 * and marks the invitation as accepted.
 */
export async function acceptTeamInvitation(
  token: string,
): Promise<ActionResult> {
  const dict = await getDictionary();
  const session = await auth();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email?.toLowerCase() ?? null;
  if (!userId || !userEmail) {
    return { ok: false, error: dict.errors.mustSignInToAccept };
  }

  const row = await db.query.accountInvitations.findFirst({
    where: and(
      eq(accountInvitations.token, token),
      isNull(accountInvitations.acceptedAt),
      isNull(accountInvitations.revokedAt),
      gt(accountInvitations.expiresAt, new Date()),
    ),
  });
  if (!row) {
    return { ok: false, error: dict.errors.invitationInvalidOrExpired };
  }
  if (row.email.toLowerCase() !== userEmail) {
    return {
      ok: false,
      error: dict.errors.invitationDifferentEmail,
    };
  }
  if (row.ownerUserId === userId) {
    return { ok: false, error: dict.errors.cannotAcceptOwnInvitation };
  }

  const existing = await db.query.accountLinks.findFirst({
    where: and(
      eq(accountLinks.managerUserId, userId),
      eq(accountLinks.managedUserId, row.ownerUserId),
    ),
  });
  if (existing) {
    await db
      .update(accountLinks)
      .set({ capabilities: sanitizeCapabilities(row.capabilities) })
      .where(eq(accountLinks.id, existing.id));
  } else {
    await db.insert(accountLinks).values({
      managerUserId: userId,
      managedUserId: row.ownerUserId,
      capabilities: sanitizeCapabilities(row.capabilities),
    });
  }

  await db
    .update(accountInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(accountInvitations.id, row.id));

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function listOwnerInvitations(ownerUserId: string) {
  return db
    .select()
    .from(accountInvitations)
    .where(eq(accountInvitations.ownerUserId, ownerUserId))
    .orderBy(desc(accountInvitations.createdAt));
}
