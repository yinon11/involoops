import { redirect } from "next/navigation";

/**
 * `/clients/<id>` alias for `/customers/<id>`.
 *
 * `/clients` was folded into `/customers` (see `../page.tsx`), but only the
 * list page got an alias — deep links to a single client kept 404ing. Those
 * links exist in the wild (older builds of the outbound create form linked
 * here from its "add tax ID" prompt, and users bookmarked them), so the
 * detail route gets the same treatment.
 */
export default async function ClientDetailAliasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/customers/${id}`);
}
