"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import type { OpenAllocationDraft } from "@/lib/outbound/open-allocation-drafts";

/**
 * The reserved numbers a period's export left out. Shown beside the file,
 * never inside it: these drafts are not income.
 */
export function OpenAllocationNotice({
  items,
}: {
  items: OpenAllocationDraft[];
}) {
  const { dict } = useI18n();
  const t = dict.shaamSubmission.openDrafts;
  if (items.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">{t.title}</p>
      <p className="mt-1">{t.body}</p>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/outbound/${item.id}`}
              className="font-mono font-medium underline underline-offset-2"
            >
              {item.formattedNumber}
            </Link>
            {" · "}
            <span dir="ltr">{item.documentDate}</span>
            {item.customerName ? ` · ${item.customerName}` : ""}
            {" · "}
            <span dir="ltr">
              {item.total} {item.currency}
            </span>
            {" · "}
            {item.shaamStatus === "HELD" ? t.held : t.refused}
          </li>
        ))}
      </ul>
    </div>
  );
}
