import type { Locale } from "../config";
import type { Dictionary } from "./en";
import { en } from "./en";
import { he } from "./he";

export type { Dictionary } from "./en";

export const dictionaries: Record<Locale, Dictionary> = {
  en,
  he,
};
