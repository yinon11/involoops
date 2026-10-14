"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import { FileMinus } from "lucide-react";

interface Props {
  originalDocumentId: string;
  originalFormattedNumber: string;
  originalIssueDate: string;
}

export function CreditNoteBanner({
  originalDocumentId,
  originalFormattedNumber,
  originalIssueDate,
}: Props) {
  const { dict } = useI18n();
  return (
    <Card className="border-2 border-red-600 bg-red-50">
      <div className="flex items-center gap-4 px-4 py-3 text-red-900">
        <FileMinus className="h-6 w-6" />
        <div className="flex-1">
          <div className="text-lg font-extrabold tracking-wide">
            {dict.outbound.creditNote.bannerTitle}
          </div>
          <div className="text-sm">
            {format(dict.outbound.creditNote.bannerReferencing, {
              number: originalFormattedNumber,
              date: originalIssueDate,
            })}{" "}
            <Link
              href={`/outbound/${originalDocumentId}`}
              className="underline hover:text-red-700"
            >
              {dict.outbound.creditNote.bannerOpenOriginal}
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
