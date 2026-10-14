"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import {
  DollarSign,
  TrendingUp,
  Wallet,
  Users,
  Receipt,
} from "lucide-react";
import { useT } from "@/lib/i18n/client";

export interface IncomeStatCardsValues {
  totalEarned: number;
  invoiceCount: number;
  monthlyAverage: number;
  runRate: number;
  clientCount: number;
  currency: string;
}

export function IncomeStatCards(values: IncomeStatCardsValues) {
  const t = useT().income.stats;
  const cards = [
    {
      key: "totalEarned",
      label: t.totalIncome,
      subtitle: (v: IncomeStatCardsValues) =>
        t.totalIncomeSubtitle.replace("{count}", v.invoiceCount.toString()),
      value: (v: IncomeStatCardsValues) =>
        formatCurrency(v.totalEarned, v.currency),
      gradient: "from-emerald-500 to-emerald-700",
      icon: DollarSign,
    },
    {
      key: "monthlyAverage",
      label: t.monthlyAverage,
      subtitle: () => t.monthlyAverageSubtitle,
      value: (v: IncomeStatCardsValues) =>
        formatCurrency(v.monthlyAverage, v.currency),
      gradient: "from-violet-500 to-violet-700",
      icon: TrendingUp,
    },
    {
      key: "runRate",
      label: t.runRate,
      subtitle: () => t.runRateSubtitle,
      value: (v: IncomeStatCardsValues) => formatCurrency(v.runRate, v.currency),
      gradient: "from-green-500 to-green-700",
      icon: Wallet,
    },
    {
      key: "clientCount",
      label: t.clients,
      subtitle: () => t.clientsSubtitle,
      value: (v: IncomeStatCardsValues) => v.clientCount.toString(),
      gradient: "from-lime-500 to-lime-700",
      icon: Users,
    },
    {
      key: "invoiceCount",
      label: t.invoicesIssued,
      subtitle: () => t.invoicesIssuedSubtitle,
      value: (v: IncomeStatCardsValues) => v.invoiceCount.toString(),
      gradient: "from-cyan-500 to-cyan-700",
      icon: Receipt,
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card
            key={card.key}
            className={`bg-gradient-to-br ${card.gradient} border-0 text-white`}
          >
            <div className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-white/80">
                  {card.label}
                </p>
                <Icon className="h-5 w-5 text-white/60" />
              </div>
              <p className="mt-2 text-2xl font-bold">{card.value(values)}</p>
              <p className="mt-1 text-sm text-white/70">
                {card.subtitle(values)}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
