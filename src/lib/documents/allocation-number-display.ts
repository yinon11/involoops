/**
 * ITA v2.0 — allocation number on printed invoice. The statutory
 * 9-digit portion is the rightmost run; we emphasise it with weight,
 * not a different font size (keeps the line visually even).
 */

export const ALLOCATION_LABEL = {
  en: "Allocation number",
  he: "מספר הקצאה",
} as const;

export type AllocationParts =
  | { kind: "short"; value: string }
  | { kind: "full"; prefix: string; last9: string };

export function splitAllocationNumber(raw: string): AllocationParts | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 9) {
    return { kind: "short", value: trimmed };
  }
  return {
    kind: "full",
    prefix: trimmed.slice(0, trimmed.length - 9),
    last9: trimmed.slice(-9),
  };
}
