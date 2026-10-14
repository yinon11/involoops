import { getDictionary, getLocale } from "@/lib/i18n/server";
import { getTeaserConfig, type TeaserSlug } from "@/lib/teasers/config";
import { getFeatureInterestState } from "@/actions/feature-interest-actions";
import { FeatureTeaserBanner } from "./feature-teaser-banner";

interface Props {
  slug: TeaserSlug;
}

/**
 * Server-side loader for the dashboard banner. Fetches live count + the
 * viewer's vote state and hands them to the client banner. Returns null
 * if the slug isn't in the catalogue (so adding the loader to a page
 * before configuring the teaser is a no-op rather than a crash).
 */
export async function FeatureTeaserBannerLoader({ slug }: Props) {
  const config = getTeaserConfig(slug);
  if (!config) return null;

  const [locale, state, dict] = await Promise.all([
    getLocale(),
    getFeatureInterestState(slug),
    getDictionary(),
  ]);

  return (
    <FeatureTeaserBanner
      config={config}
      locale={locale}
      initialCount={state.count}
      initialVoted={state.hasVoted}
      closeLabel={dict.common.close}
    />
  );
}
