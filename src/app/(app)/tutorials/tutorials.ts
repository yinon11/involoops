import type { Dictionary } from "@/lib/i18n/dictionaries/en";

type TutorialKey = keyof Dictionary["tutorials"]["items"];

export interface TutorialSummary {
  slug: string;
  key: TutorialKey;
}

export const tutorials: TutorialSummary[] = [
  { slug: "getting-started", key: "gettingStarted" },
  { slug: "upload-invoices", key: "uploadInvoices" },
  { slug: "pending-queue", key: "pendingQueue" },
  { slug: "invoices-list", key: "invoicesList" },
  { slug: "invoice-detail", key: "invoiceDetail" },
  { slug: "vendors", key: "vendors" },
  { slug: "duplicates", key: "duplicates" },
  { slug: "dashboard", key: "dashboard" },
  { slug: "income-and-profit", key: "incomeAndProfit" },
  { slug: "outbound-invoicing", key: "outboundInvoicing" },
  { slug: "settings", key: "settings" },
];

export function getTutorialBySlug(
  slug: string
): TutorialSummary | undefined {
  return tutorials.find((t) => t.slug === slug);
}
