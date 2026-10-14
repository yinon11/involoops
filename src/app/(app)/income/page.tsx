import { redirect } from "next/navigation";

/**
 * Alias for the uploaded-income view, which now lives as a tab on the income
 * overview rather than as its own page rendering a second `IncomeClient`.
 */
export default function IncomeAliasPage() {
  redirect("/money-in?tab=uploaded");
}
