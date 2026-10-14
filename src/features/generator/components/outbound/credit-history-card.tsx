import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n";

export interface CreditHistoryEntry {
  creditNoteId: string;
  formattedNumber: string;
  createdAt: Date;
  amount: string;
  reason: string | null;
  linkType: "CREDIT_REVERSES" | "CREDIT_PARTIAL";
}

interface Props {
  entries: CreditHistoryEntry[];
  remainingAmount: string;
  originalTotal: string;
  currency: string;
}

export async function CreditHistoryCard({
  entries,
  remainingAmount,
  originalTotal,
  currency,
}: Props) {
  const dict = await getDictionary();
  const fullyCredited = Number(remainingAmount) <= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {dict.outbound.creditNote.historyTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-gray-50 p-3 text-sm">
          {fullyCredited ? (
            <Badge className="bg-red-100 text-red-700">
              {dict.outbound.creditNote.fullyCredited}
            </Badge>
          ) : entries.length === 0 ? (
            <span className="text-gray-500">
              {dict.outbound.creditNote.historyEmpty}
            </span>
          ) : (
            <span>
              {format(dict.outbound.creditNote.partiallyCredited, {
                amount: `${remainingAmount} ${currency}`,
              })}
              <span className="ms-2 text-gray-500">
                / {originalTotal} {currency}
              </span>
            </span>
          )}
        </div>

        {entries.length > 0 && (
          <ul className="divide-y">
            {entries.map((entry) => (
              <li
                key={entry.creditNoteId}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    variant="secondary"
                    className={
                      entry.linkType === "CREDIT_REVERSES"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-800"
                    }
                  >
                    {entry.linkType === "CREDIT_REVERSES" ? "Full" : "Partial"}
                  </Badge>
                  <Link
                    href={`/outbound/${entry.creditNoteId}`}
                    className="font-mono font-medium hover:underline"
                  >
                    {entry.formattedNumber}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {entry.createdAt
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-red-700">
                    -{entry.amount} {currency}
                  </span>
                </div>
                {entry.reason && (
                  <p className="w-full text-xs text-gray-600">
                    {entry.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
