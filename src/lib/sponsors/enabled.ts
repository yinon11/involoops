/**
 * Master switch for sponsored offers on the home dashboard.
 *
 * Off unless SPONSORS_ENABLED is set to true (or 1, yes, on): showing
 * partner offers is a commercial decision, so a fresh deploy must not start
 * doing it on its own.
 */
export function areSponsorsEnabled(): boolean {
  const raw = process.env.SPONSORS_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
