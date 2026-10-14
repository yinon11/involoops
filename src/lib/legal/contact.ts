/**
 * The address the legal pages name for privacy requests, security reports
 * and legal notices.
 *
 * Read from the environment so each deployment names its own operator: a
 * self-hosted copy that kept ours would point its users' data requests at
 * someone who does not hold their data. The default is a role address, never
 * a person's mailbox — it survives staff changes and is what the privacy
 * notice should name.
 */
export const DEFAULT_LEGAL_CONTACT_EMAIL = "privacy@involoops.com";

export function legalContactEmail(): string {
  return process.env.LEGAL_CONTACT_EMAIL?.trim() || DEFAULT_LEGAL_CONTACT_EMAIL;
}
