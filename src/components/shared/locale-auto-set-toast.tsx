"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import {
  isLocale,
  localeConfig,
  LOCALE_AUTO_SET_COOKIE,
  type Locale,
} from "@/lib/i18n";

/**
 * Shows a one-time toast after the server auto-picks a locale for a user
 * (e.g. first sign-in with no stored preference). The `signIn` event writes
 * `NEXT_LOCALE_AUTO=<locale>`; we read it here once, announce the choice,
 * and immediately expire the cookie so it doesn't fire again.
 */
export function LocaleAutoSetToast() {
  const { dict } = useI18n();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const match = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${LOCALE_AUTO_SET_COOKIE}=`));
    if (!match) return;

    const value = decodeURIComponent(match.split("=")[1] ?? "");
    document.cookie = `${LOCALE_AUTO_SET_COOKIE}=; path=/; max-age=0; samesite=lax`;

    if (!isLocale(value)) return;
    const name = localeConfig[value as Locale].name;
    toast(dict.common.languageAutoSetTitle, {
      description: dict.common.languageAutoSetDescription.replace(
        "{language}",
        name,
      ),
      duration: 8000,
    });
  }, [dict]);

  return null;
}
