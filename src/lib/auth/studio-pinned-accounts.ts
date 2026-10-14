/**
 * Accounts that must always land in the Studio (creator) shell on sign-in /
 * app entry, regardless of how they authenticated or which account they end up
 * acting-as. Compared case-insensitively against the signed-in user's own
 * email (the credentials/OAuth account, before any act-as switch).
 *
 * This is operator-specific, so it is configuration rather than code: set
 * `STUDIO_PINNED_EMAILS` to a comma-separated list. Unset means nobody is
 * pinned, which is the right default for every installation but the one that
 * needs it.
 */
let pinned: Set<string> | null = null;

/** Read lazily: at module-load time the env may not be populated yet. */
function pinnedEmails(): Set<string> {
  if (!pinned) {
    pinned = new Set(
      (process.env.STUDIO_PINNED_EMAILS ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    );
  }
  return pinned;
}

export function isStudioPinnedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const emails = pinnedEmails();
  if (emails.size === 0) return false;
  return emails.has(email.toLowerCase());
}
