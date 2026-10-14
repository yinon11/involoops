/**
 * Same-origin URL for a campaign's image, versioned by its update time so a
 * replaced image is fetched fresh while an unchanged one stays cached.
 */
export function sponsorImageUrl(
  campaignId: string,
  imageUpdatedAt: Date | null | undefined,
): string | null {
  if (!imageUpdatedAt) return null;
  return `/api/sponsors/image/${campaignId}?v=${imageUpdatedAt.getTime()}`;
}
