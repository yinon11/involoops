/** Same rule as outbound send — keeps validation consistent across UI and SES. */
export function isValidEmailAddress(value: string): boolean {
  const s = value.trim();
  return s.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export interface ParsedMailbox {
  email: string;
  displayName?: string;
}

/**
 * Parse `user@domain.com` or `Display Name <user@domain.com>` (see SES_FROM_EMAIL
 * in .env.example). Returns null when no valid mailbox is found.
 */
export function parseMailboxAddress(value: string): ParsedMailbox | null {
  const s = value.trim();
  if (!s) return null;

  const angle = /^(.+?)\s*<([^>]+)>$/.exec(s);
  if (angle) {
    const email = angle[2].trim();
    if (!isValidEmailAddress(email)) return null;
    const rawName = angle[1].trim().replace(/^["']|["']$/g, "");
    return rawName ? { email, displayName: rawName } : { email };
  }

  if (isValidEmailAddress(s)) return { email: s };
  return null;
}

/** RFC 5322 From / Reply-To line for raw MIME (keeps display name when set). */
export function formatMailboxAddress(mailbox: ParsedMailbox): string {
  if (!mailbox.displayName) return mailbox.email;
  const name = mailbox.displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${name}" <${mailbox.email}>`;
}

/**
 * Reply-To for outbound mail. Invalid template values (e.g. a bare domain
 * saved in the email field) are ignored so SES does not reject the send.
 */
export function resolveReplyToAddress(
  primary?: string | null,
  fallback?: string | null,
): string | undefined {
  const p = primary?.trim();
  if (p && isValidEmailAddress(p)) return p;
  const f = fallback?.trim();
  if (f && isValidEmailAddress(f)) return f;
  return undefined;
}
