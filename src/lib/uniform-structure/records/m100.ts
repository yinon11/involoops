/**
 * M100 — inventory item master (v1.31 §4.8). InvoLoops doesn't
 * track real inventory — we synthesize one M100 per unique line
 * description seen in D110 records, with zero balances and zero
 * traffic. The spec requires every D110 internalSku to have a
 * matching M100 row.
 *
 * Total length 298 chars.
 */

import type { FieldSpec } from "../types";
import { serializeRecord } from "./serializer";

export interface M100Record {
  recordCode: "M100";
  /** 1451 — running line number in BKMVDATA. */
  recordSequence: string;
  /** 1452 — business VAT number. */
  vatNumber: string;
  /** 1453 — universal SKU (e.g. EAN, 20 chars). */
  universalSku?: string;
  /** 1454 — supplier/manufacturer SKU (20 chars). */
  supplierSku?: string;
  /** 1455 — internal SKU (20 chars, mandatory; one-to-one with D110.internalSku). */
  internalSku: string;
  /** 1456 — item name (50 chars, mandatory). */
  itemName: string;
  /** 1457 — sort code (10 chars). */
  sortCode?: string;
  /** 1458 — sort code description (30 chars). */
  sortDescription?: string;
  /** 1459 — unit-of-measure description (20 chars, mandatory). */
  unitOfMeasureDescription: string;
  /** 1460 — opening balance for the period (signed, X9(9)v99). */
  openingBalance: string;
  /** 1461 — total entries in the period (signed, X9(9)v99). */
  totalEntries: string;
  /** 1462 — total exits in the period (signed, X9(9)v99). */
  totalExits: string;
  /** 1463 — period-end cost price, non-bonded warehouses (9(8)v99 → 10 wide). */
  costPriceNonBonded?: string;
  /** 1464 — period-end cost price, bonded warehouses. */
  costPriceBonded?: string;
  /** 1465 — reserved (50 chars). */
  reservedFutureUse?: string;
}

export const M100_FIELDS: readonly FieldSpec[] = [
  { name: "recordCode", fieldNumber: 1450, start: 1, length: 4, type: "text", mandatory: true, value: "M100" },
  { name: "recordSequence", fieldNumber: 1451, start: 5, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "vatNumber", fieldNumber: 1452, start: 14, length: 9, type: "numeric", mandatory: true, pad: "0" },
  { name: "universalSku", fieldNumber: 1453, start: 23, length: 20, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "supplierSku", fieldNumber: 1454, start: 43, length: 20, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "internalSku", fieldNumber: 1455, start: 63, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "itemName", fieldNumber: 1456, start: 83, length: 50, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "sortCode", fieldNumber: 1457, start: 133, length: 10, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "sortDescription", fieldNumber: 1458, start: 143, length: 30, type: "text", mandatory: false, justify: "left", pad: " " },
  { name: "unitOfMeasureDescription", fieldNumber: 1459, start: 173, length: 20, type: "text", mandatory: true, justify: "left", pad: " " },
  { name: "openingBalance", fieldNumber: 1460, start: 193, length: 12, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "totalEntries", fieldNumber: 1461, start: 205, length: 12, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "totalExits", fieldNumber: 1462, start: 217, length: 12, type: "signedNumeric", mandatory: true, decimals: 2 },
  { name: "costPriceNonBonded", fieldNumber: 1463, start: 229, length: 10, type: "amount", mandatory: false, decimals: 2 },
  { name: "costPriceBonded", fieldNumber: 1464, start: 239, length: 10, type: "amount", mandatory: false, decimals: 2 },
  { name: "reservedFutureUse", fieldNumber: 1465, start: 249, length: 50, type: "text", mandatory: false, justify: "left", pad: " " },
];

export const M100_TOTAL_LENGTH = 298;

export function serializeM100(record: M100Record): string {
  return serializeRecord(M100_FIELDS, record, M100_TOTAL_LENGTH);
}
