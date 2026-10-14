/**
 * Public-facing tutorial registry — re-exports the auth-gated registry from
 * `(app)/tutorials/` and adds a product association for cross-linking back
 * to the relevant product page.
 *
 * Intentionally leaves the `(app)/tutorials/...` UI in place — same content,
 * served behind auth from the in-app shell. This file is the SEO surface
 * (linked from /learn and the sitemap, public allowlist).
 */
export { tutorials, getTutorialBySlug } from "@/app/(app)/tutorials/tutorials";
import { tutorials } from "@/app/(app)/tutorials/tutorials";

type Product = "insights" | "studio";

const PRODUCT_BY_SLUG: Record<string, Product> = {
  "getting-started": "insights",
  "upload-invoices": "insights",
  vendors: "insights",
  // When tutorials gain Studio entries (e.g. "issue-first-invoice"), register
  // them here so the index card and detail page both show the right product
  // tag and link back to the home page's #studio section instead of #insights.
};

export function getTutorialProduct(slug: string): Product {
  return PRODUCT_BY_SLUG[slug] ?? "insights";
}

export function getAllTutorialSlugs(): string[] {
  return tutorials.map((t) => t.slug);
}
