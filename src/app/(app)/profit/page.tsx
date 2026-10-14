import { redirect } from "next/navigation";

/**
 * Alias for the profit view, which now lives as a tab on the income overview
 * rather than as its own page rendering a second `ProfitClient`.
 */
export default function ProfitAliasPage() {
  redirect("/money-in?tab=profit");
}
