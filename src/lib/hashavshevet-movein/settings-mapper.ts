import type { moveinExportSettings } from "@/db/schema/movein-export";
import type { MoveinCardMapping, MoveinMethod } from "./types";

type SettingsRow = typeof moveinExportSettings.$inferSelect;

export function settingsRowToCardMapping(row: SettingsRow): MoveinCardMapping {
  return {
    generalCash: row.generalCash,
    creditCardCash: row.creditCardCash,
    cash: row.cash,
    checkCash: row.checkCash,
    transferUsd: row.transferUsd,
    transferEur: row.transferEur,
    transferGbp: row.transferGbp,
    transferJpy: row.transferJpy,
    paypal: row.paypal,
    bit: row.bit,
    pepper: row.pepper,
    credit: row.credit,
    purchase: row.purchase,
    inputVat: row.inputVat,
    withholdingTax: row.withholdingTax,
    outputVat: row.outputVat,
    income: row.income,
    exemptIncome: row.exemptIncome,
    cashCustomer: row.cashCustomer,
  };
}

export function isMoveinMethod(value: string): value is MoveinMethod {
  return value === "detailed" || value === "short" || value === "flexible";
}

const REQUIRED_CARD_KEYS: (keyof MoveinCardMapping)[] = [
  "generalCash",
  "income",
  "outputVat",
  "cashCustomer",
];

export function validateCardMappingComplete(
  cards: MoveinCardMapping,
): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_CARD_KEYS) {
    const v = cards[key]?.trim();
    if (!v || v === "0") {
      missing.push(key);
    }
  }
  return missing;
}
