/**
 * Helpers for the per-user Gmail-forwarding alias. The alias is the local
 * part of `<alias>@involoops.com` — the address users can forward invoices
 * to.
 *
 * Format: `<adjective>-<animal>-<NN>` e.g. `brisk-otter-42`. Chosen for:
 *   - Human-dictable over phone/video when setting up forwarding rules.
 *   - Unguessable enough to act as a modest defense-in-depth on top of
 *     DKIM-verified sender matching.
 *   - Bounded in length (never exceeds 32 chars so it fits comfortably in
 *     the varchar(64) column and in any mailbox's local-part limit).
 *
 * Word lists are deliberately small, friendly, and uncontroversial. Curated
 * by hand — do not replace with a generic package, it will reintroduce
 * words that are embarrassing on a customer-facing address.
 */

const ADJECTIVES = [
  "amber", "azure", "brisk", "breezy", "bright", "calm", "clear",
  "cozy", "crisp", "eager", "fancy", "fluffy", "fresh", "gentle",
  "happy", "jolly", "kind", "lively", "lucky", "merry", "mighty",
  "nimble", "plucky", "proud", "quick", "quiet", "royal", "sleek",
  "smart", "snappy", "spry", "steady", "sunny", "swift", "tidy",
  "vivid", "witty", "zesty",
];

const ANIMALS = [
  "badger", "beaver", "bison", "crane", "deer", "dove", "eagle",
  "elk", "falcon", "ferret", "finch", "fox", "goose", "hawk",
  "heron", "ibex", "koala", "lark", "lynx", "moose", "otter",
  "owl", "panda", "quail", "rabbit", "raven", "robin", "seal",
  "sparrow", "squirrel", "swan", "tiger", "turtle", "wolf", "wren",
  "yak",
];

/**
 * Regex enforcing the subset of email-local-part syntax we allow. Lowercase
 * letters + digits + single hyphens, not starting/ending with a hyphen,
 * length 3..64. Matches what Gmail's local-part accepts and what our
 * `users.invoice_alias` varchar(64) holds.
 */
export const INVOICE_ALIAS_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

/**
 * Generate one random alias candidate. Does NOT check the DB — the caller is
 * responsible for uniqueness. Pair with a retry loop that handles the
 * (very rare) partial-unique-index collision.
 */
export function generateAliasCandidate(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  // 2–3 digit suffix (10..999). Avoid 0-padding so aliases stay human-dictable.
  const n = 10 + Math.floor(Math.random() * 990);
  return `${adj}-${animal}-${n}`;
}
