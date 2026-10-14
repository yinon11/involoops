import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Strip NUL bytes — Postgres text fields reject UTF-8 containing 0x00 (common in PDF extraction). */
export function sanitizePostgresText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.replace(/\x00/g, "");
}
