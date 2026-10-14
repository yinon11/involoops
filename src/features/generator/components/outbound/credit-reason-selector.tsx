"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/client";

export type CreditReasonKey =
  | "AMOUNT_ERROR"
  | "CUSTOMER_DETAIL_ERROR"
  | "PRODUCT_RETURN"
  | "CANCELLATION"
  | "OTHER";

const REASON_KEYS: CreditReasonKey[] = [
  "AMOUNT_ERROR",
  "CUSTOMER_DETAIL_ERROR",
  "PRODUCT_RETURN",
  "CANCELLATION",
  "OTHER",
];

interface Props {
  reasonKey: CreditReasonKey | null;
  reasonText: string;
  onChange: (reasonKey: CreditReasonKey | null, text: string) => void;
  /** Reason was rejected as too short. Border only — the message stays separate. */
  invalid?: boolean;
}

export function CreditReasonSelector({
  reasonKey,
  reasonText,
  onChange,
  invalid = false,
}: Props) {
  const { dict } = useI18n();

  function handleKeyChange(value: string) {
    const next = value as CreditReasonKey;
    if (next === "OTHER") {
      onChange(next, reasonText);
    } else {
      onChange(next, dict.outbound.creditNote.reasons[next]);
    }
  }

  const needsCustomText = reasonKey === "OTHER";

  return (
    <div
      className={`space-y-2 rounded-md ${invalid ? "border border-red-500 p-3" : ""}`}
    >
      <Label className="text-sm">{dict.outbound.creditNote.reason}</Label>
      <Select value={reasonKey ?? undefined} onValueChange={handleKeyChange}>
        <SelectTrigger>
          <SelectValue placeholder={dict.outbound.creditNote.reasonPickerPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {REASON_KEYS.map((k) => (
            <SelectItem key={k} value={k}>
              {dict.outbound.creditNote.reasons[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(needsCustomText || reasonKey) && (
        <Textarea
          rows={3}
          value={reasonText}
          onChange={(e) => onChange(reasonKey, e.target.value)}
          placeholder={dict.outbound.creditNote.reasonPlaceholder}
          disabled={!needsCustomText && reasonKey !== null && reasonText === dict.outbound.creditNote.reasons[reasonKey]}
          className={needsCustomText ? "" : "bg-gray-50"}
        />
      )}
      <p className="text-[11px] text-gray-500">
        {reasonText.trim().length}/10
      </p>
    </div>
  );
}
