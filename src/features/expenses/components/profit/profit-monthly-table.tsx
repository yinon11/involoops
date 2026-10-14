"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { ExportXlsxButton } from "@/components/shared/export-xlsx-button";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

interface MonthlyRow {
  month: string;
  income: number;
  expense: number;
  profit: number;
}

interface ProfitMonthlyTableProps {
  data: MonthlyRow[];
  currency: string;
}

const MONTH_KEYS: (keyof Dictionary["profit"]["monthsLong"])[] = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function formatMonth(
  bucket: string,
  monthsLong: Dictionary["profit"]["monthsLong"],
): string {
  const [y, m] = bucket.split("-");
  const idx = parseInt(m, 10) - 1;
  const key = MONTH_KEYS[idx];
  const name = key ? monthsLong[key] : "";
  return `${name} ${y}`;
}

export function ProfitMonthlyTable({ data, currency }: ProfitMonthlyTableProps) {
  const { dict } = useI18n();
  const t = dict.profit.table;
  const monthsLong = dict.profit.monthsLong;
  // Show newest first — matches how users typically scan a P&L.
  const rows = [...data].reverse();

  const totals = data.reduce(
    (acc, row) => ({
      income: acc.income + row.income,
      expense: acc.expense + row.expense,
      profit: acc.profit + row.profit,
    }),
    { income: 0, expense: 0, profit: 0 }
  );

  const buildExportRows = () =>
    rows.map((row) => {
      const margin =
        row.income > 0 ? (row.profit / row.income) * 100 : null;
      return {
        [t.exportCols.month]: formatMonth(row.month, monthsLong),
        [t.exportCols.income]: row.income,
        [t.exportCols.expenses]: row.expense,
        [t.exportCols.profit]: row.profit,
        [t.exportCols.marginPct]:
          margin === null ? "" : Number(margin.toFixed(2)),
        [t.exportCols.currency]: currency,
      };
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg font-semibold">{t.title}</CardTitle>
          <ExportXlsxButton
            rows={buildExportRows}
            filename={t.exportFilename}
            sheetName={t.exportSheetName}
            disabled={rows.length === 0}
          />
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t.empty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.cols.month}</TableHead>
                  <TableHead className="text-end">{t.cols.income}</TableHead>
                  <TableHead className="text-end">{t.cols.expenses}</TableHead>
                  <TableHead className="text-end">{t.cols.profit}</TableHead>
                  <TableHead className="text-end">{t.cols.margin}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const margin = row.income > 0
                    ? (row.profit / row.income) * 100
                    : null;
                  const profitPositive = row.profit > 0;
                  const profitNeutral = row.profit === 0;
                  return (
                    <TableRow key={row.month}>
                      <TableCell className="font-medium">
                        {formatMonth(row.month, monthsLong)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(row.income, currency)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-rose-700 dark:text-rose-400">
                        {formatCurrency(row.expense, currency)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-end font-semibold tabular-nums",
                          profitNeutral
                            ? "text-muted-foreground"
                            : profitPositive
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-rose-700 dark:text-rose-400"
                        )}
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          {profitNeutral ? (
                            <Minus className="h-3 w-3" />
                          ) : profitPositive ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )}
                          {formatCurrency(row.profit, currency)}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-end tabular-nums",
                          margin === null
                            ? "text-muted-foreground"
                            : margin >= 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-rose-700 dark:text-rose-400"
                        )}
                      >
                        {margin === null ? "—" : `${margin.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
                  <TableCell>{t.total}</TableCell>
                  <TableCell className="text-end tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(totals.income, currency)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-rose-700 dark:text-rose-400">
                    {formatCurrency(totals.expense, currency)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-end tabular-nums",
                      totals.profit >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-rose-700 dark:text-rose-400"
                    )}
                  >
                    {formatCurrency(totals.profit, currency)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-end tabular-nums",
                      totals.income === 0
                        ? "text-muted-foreground"
                        : totals.profit >= 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-700 dark:text-rose-400"
                    )}
                  >
                    {totals.income === 0
                      ? "—"
                      : `${((totals.profit / totals.income) * 100).toFixed(1)}%`}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
