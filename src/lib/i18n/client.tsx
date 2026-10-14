"use client";

import React, { createContext, useContext, useMemo } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import { localeConfig, type Locale } from "./config";
import type { Dictionary } from "./dictionaries";

interface I18nContextValue {
  locale: Locale;
  tag: string;
  dir: "ltr" | "rtl";
  dict: Dictionary;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      tag: localeConfig[locale].tag,
      dir: localeConfig[locale].dir,
      dict,
    }),
    [locale, dict]
  );
  return (
    <I18nContext.Provider value={value}>
      <DirectionProvider dir={value.dir}>{children}</DirectionProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}

/** Shortcut hook — returns just the dictionary. */
export function useT(): Dictionary {
  return useI18n().dict;
}

/** Shortcut hook — returns just the BCP 47 tag for `Intl` formatters. */
export function useLocaleTag(): string {
  return useI18n().tag;
}
