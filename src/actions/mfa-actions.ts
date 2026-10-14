"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  buildOtpAuthUrl,
  consumeBackupCode,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  renderQrDataUri,
  verifyTotpCode,
} from "@/lib/mfa";
import { getDictionary } from "@/lib/i18n/server";

/**
 * Session-scoped staging area for in-progress MFA setup. We can't write the
 * plaintext secret to the database before the user confirms they can scan it
 * (otherwise a crashed setup leaves a usable secret at rest that the user
 * has no way to activate). Keeping it in memory ties the secret to the
 * Node process and evicts itself on restart; the user just restarts setup.
 *
 * Map key: `${userId}:${issuedAt}` — userId alone would leak across parallel
 * attempts. We only store one entry per user at a time, so concurrent tabs
 * that start setup will invalidate each other (last writer wins).
 */
const pendingSetups = new Map<
  string,
  { secret: string; issuedAt: number }
>();
const PENDING_TTL_MS = 15 * 60 * 1000;

function prunePendingSetups() {
  const now = Date.now();
  for (const [key, value] of pendingSetups) {
    if (now - value.issuedAt > PENDING_TTL_MS) pendingSetups.delete(key);
  }
}

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new Error("You must be signed in.");
  }
  return { userId: session.user.id, email: session.user.email };
}

export type MfaStatus = {
  enabled: boolean;
  backupCodesRemaining: number;
  enabledAt: Date | null;
};

export async function getMfaStatus(): Promise<MfaStatus> {
  const { userId } = await requireSession();
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      mfaEnabled: true,
      mfaEnabledAt: true,
      mfaBackupCodes: true,
    },
  });
  return {
    enabled: Boolean(row?.mfaEnabled),
    backupCodesRemaining: row?.mfaBackupCodes?.length ?? 0,
    enabledAt: row?.mfaEnabledAt ?? null,
  };
}

export type InitiateMfaResult =
  | {
      ok: true;
      qrDataUri: string;
      manualEntryKey: string;
    }
  | { ok: false; error: string };

/**
 * Start MFA enrollment. Generates a fresh TOTP secret, stages it in memory,
 * and hands the client a QR code plus manual-entry key. Nothing is persisted
 * until the user successfully verifies a code via `verifyMfaSetup`.
 */
export async function initiateMfaSetup(): Promise<InitiateMfaResult> {
  const dict = await getDictionary();
  try {
    prunePendingSetups();
    const { userId, email } = await requireSession();

    // Block reinitialization once MFA is active — use `changeMfa` instead,
    // which requires re-authenticating against the current factor first.
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { mfaEnabled: true },
    });
    if (row?.mfaEnabled) {
      return {
        ok: false,
        error: dict.errors.mfaAlreadyEnabled,
      };
    }

    const secret = generateTotpSecret();
    pendingSetups.set(userId, { secret, issuedAt: Date.now() });

    const otpAuthUrl = buildOtpAuthUrl({ accountName: email, secret });
    const qrDataUri = await renderQrDataUri(otpAuthUrl);
    return {
      ok: true,
      qrDataUri,
      manualEntryKey: secret,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to start MFA setup.",
    };
  }
}

export type VerifySetupResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; error: string };

/**
 * Finish MFA enrollment: confirm the user typed a valid TOTP code for the
 * staged secret, then persist the encrypted secret and bcrypt-hashed backup
 * codes atomically. Plaintext backup codes are returned exactly once so the
 * user can save them; we don't keep a copy.
 */
export async function verifyMfaSetup(
  rawCode: string
): Promise<VerifySetupResult> {
  const dict = await getDictionary();
  try {
    prunePendingSetups();
    const { userId } = await requireSession();
    const pending = pendingSetups.get(userId);
    if (!pending) {
      return {
        ok: false,
        error: dict.errors.mfaSetupExpired,
      };
    }

    const ok = verifyTotpCode({ code: rawCode, secret: pending.secret });
    if (!ok) {
      return {
        ok: false,
        error:
          "That code didn't match. Wait for a fresh one and try again.",
      };
    }

    const encrypted = encryptSecret(pending.secret);
    const { plaintext, hashes } = await generateBackupCodes();

    await db
      .update(users)
      .set({
        mfaEnabled: true,
        mfaSecretCiphertext: encrypted.ciphertext,
        mfaSecretIv: encrypted.iv,
        mfaSecretTag: encrypted.tag,
        mfaEnabledAt: new Date(),
        mfaBackupCodes: hashes,
      })
      .where(eq(users.id, userId));

    pendingSetups.delete(userId);

    return { ok: true, backupCodes: plaintext };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to verify MFA setup.",
    };
  }
}

export type DisableMfaResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Turn MFA off. Requires a current TOTP code (or backup code) AND the account
 * password — without the password gate, an attacker who pocketed an unlocked
 * laptop could disable MFA and walk off with the account.
 */
export async function disableMfa(params: {
  password: string;
  code: string;
}): Promise<DisableMfaResult> {
  const dict = await getDictionary();
  try {
    const { userId } = await requireSession();
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        passwordHash: true,
        mfaEnabled: true,
        mfaSecretCiphertext: true,
        mfaSecretIv: true,
        mfaSecretTag: true,
        mfaBackupCodes: true,
      },
    });
    if (!row?.mfaEnabled) {
      return { ok: false, error: dict.errors.mfaNotEnabled };
    }
    if (!row.passwordHash) {
      return {
        ok: false,
        error: dict.errors.mfaNeedsPassword,
      };
    }

    const passwordOk = await bcrypt.compare(params.password, row.passwordHash);
    if (!passwordOk) {
      return { ok: false, error: dict.errors.incorrectPassword };
    }

    const codeOk = await verifyMfaInput({
      input: params.code,
      ciphertext: row.mfaSecretCiphertext,
      iv: row.mfaSecretIv,
      tag: row.mfaSecretTag,
      backupHashes: row.mfaBackupCodes ?? [],
    });
    if (!codeOk.valid) {
      return { ok: false, error: dict.errors.invalidVerificationCode };
    }

    await db
      .update(users)
      .set({
        mfaEnabled: false,
        mfaSecretCiphertext: null,
        mfaSecretIv: null,
        mfaSecretTag: null,
        mfaEnabledAt: null,
        mfaBackupCodes: null,
      })
      .where(eq(users.id, userId));

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to disable MFA.",
    };
  }
}

export type RegenerateBackupCodesResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; error: string };

/**
 * Rotate backup codes — e.g. after the user suspects they were leaked or
 * used one up. Old codes are invalidated. Requires a current TOTP to prove
 * the user isn't just a bystander.
 */
export async function regenerateBackupCodes(
  code: string
): Promise<RegenerateBackupCodesResult> {
  const dict = await getDictionary();
  try {
    const { userId } = await requireSession();
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        mfaEnabled: true,
        mfaSecretCiphertext: true,
        mfaSecretIv: true,
        mfaSecretTag: true,
        mfaBackupCodes: true,
      },
    });
    if (!row?.mfaEnabled) {
      return { ok: false, error: dict.errors.mfaNotEnabled };
    }
    const codeOk = await verifyMfaInput({
      input: code,
      ciphertext: row.mfaSecretCiphertext,
      iv: row.mfaSecretIv,
      tag: row.mfaSecretTag,
      backupHashes: row.mfaBackupCodes ?? [],
    });
    if (!codeOk.valid) {
      return { ok: false, error: dict.errors.invalidVerificationCode };
    }

    const { plaintext, hashes } = await generateBackupCodes();
    await db
      .update(users)
      .set({ mfaBackupCodes: hashes })
      .where(eq(users.id, userId));

    return { ok: true, backupCodes: plaintext };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to regenerate backup codes.",
    };
  }
}

/**
 * Shared verification used by login, disable, and regenerate. Accepts either
 * a 6-digit TOTP or a single-use backup code; when a backup code is spent,
 * it's pruned from the stored hash array.
 */
export async function verifyMfaInput(params: {
  input: string;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  backupHashes: string[];
}): Promise<{ valid: boolean; updatedBackupHashes?: string[] }> {
  const trimmed = params.input.trim();
  if (!trimmed) return { valid: false };

  // Fast path: 6 digits → TOTP.
  const cleaned = trimmed.replace(/\s/g, "");
  if (/^\d{6}$/.test(cleaned)) {
    if (!params.ciphertext || !params.iv || !params.tag) {
      return { valid: false };
    }
    try {
      const secret = decryptSecret({
        ciphertext: params.ciphertext,
        iv: params.iv,
        tag: params.tag,
      });
      if (verifyTotpCode({ code: cleaned, secret })) {
        return { valid: true };
      }
    } catch {
      return { valid: false };
    }
    return { valid: false };
  }

  // Backup code path — treat any non-numeric input as a potential code.
  const remaining = await consumeBackupCode({
    input: trimmed,
    storedHashes: params.backupHashes,
  });
  if (remaining) {
    return { valid: true, updatedBackupHashes: remaining };
  }
  return { valid: false };
}
