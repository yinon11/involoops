"use client";

import { formatCurrency, getCurrencySymbol } from "@/lib/currency";

interface CurrencyDisplayProps {
  amount: number;
  currency: string;
  showSymbol?: boolean;
}

export function CurrencyDisplay({
  amount,
  currency,
  showSymbol = true,
}: CurrencyDisplayProps) {
  const formatted = showSymbol
    ? formatCurrency(amount, currency)
    : amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

  return <span className="font-medium text-blue-600">{formatted}</span>;
}
