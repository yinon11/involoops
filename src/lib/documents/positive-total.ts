import { addMoney, compareMoney } from "@/lib/money";

const MESSAGE =
  "The document total must be greater than zero. Negative lines are allowed, but they cannot bring the total to zero or below. A credit note is the document that carries a negative total.";

/**
 * Every document except a credit note may contain negative lines, and
 * its total must still be greater than zero. Credit notes are stored
 * as a negative sum and are the exception.
 */
export function documentTotalMustBePositiveMessage(params: {
  documentType: string;
  total: string | number;
  items?: Array<{ quantity?: number; unitPrice?: number; total?: number }> | null;
}): string | null {
  if (params.documentType === "CREDIT_INVOICE") return null;
  if (!Number.isFinite(Number(params.total)) || compareMoney(params.total, "0") <= 0) {
    return MESSAGE;
  }
  if (!params.items?.length) return null;

  let lineSum = "0.00";
  for (const item of params.items) {
    const line =
      item.total != null && Number.isFinite(Number(item.total))
        ? item.total
        : Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
    if (!Number.isFinite(Number(line))) return MESSAGE;
    lineSum = addMoney(lineSum, line);
  }
  if (compareMoney(lineSum, "0") <= 0) return MESSAGE;
  return null;
}
