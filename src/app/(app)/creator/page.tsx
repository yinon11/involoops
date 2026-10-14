import { redirect } from "next/navigation";

/**
 * The income overview used to live here while "Money In" lived at
 * /money-in, and the two answered the same question from different ends.
 * They are one page now; this keeps every existing link, bookmark and
 * voice-navigation target working, forwarding the period filter with it.
 */
export default async function CreatorRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const qs = params.toString();
  redirect(qs ? `/money-in?${qs}` : "/money-in");
}
