"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { setLocaleAction } from "@/actions/locale-actions";
import { locales, localeConfig, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/**
 * Swap (or insert) the leading locale segment in `pathname`. Public marketing
 * routes live under `/[locale]/...`, so picking a different language must
 * navigate to the equivalent URL — middleware reads the locale from the URL
 * prefix first and ignores cookies for those paths. Returns `null` when the
 * pathname is not under a locale prefix (auth/app/api), letting the caller
 * fall back to a plain `router.refresh()`.
 */
function swapLocaleInPath(pathname: string, next: Locale): string | null {
  if (pathname === "/en" || pathname === "/he") return `/${next}`;
  if (pathname.startsWith("/en/") || pathname.startsWith("/he/")) {
    return `/${next}${pathname.slice(3)}`;
  }
  return null;
}

/**
 * Header language picker. On locale-prefixed marketing routes it navigates to
 * the equivalent path under the new locale; everywhere else it just refreshes
 * after persisting the cookie + DB preference via the server action.
 */
export function LanguageSwitcher({
  variant = "onDark",
}: {
  variant?: "onDark" | "onLight";
}) {
  const { locale, dict } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleSelect(next: string) {
    if (next === locale) return;
    if (next !== "en" && next !== "he") return;
    startTransition(async () => {
      await setLocaleAction(next);
      const swapped = swapLocaleInPath(pathname ?? "/", next);
      if (swapped) {
        const qs = searchParams?.toString();
        router.push(qs ? `${swapped}?${qs}` : swapped);
      } else {
        router.refresh();
      }
    });
  }

  const triggerClassName =
    variant === "onLight"
      ? "flex items-center gap-1 text-foreground/80 hover:bg-secondary hover:text-foreground"
      : "flex items-center gap-1 text-white hover:bg-white/10 hover:text-white";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          className={triggerClassName}
          aria-label={dict.common.language}
        >
          <Globe className="h-4 w-4" />
          <span className="hidden text-sm sm:inline">
            {localeConfig[locale].name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => handleSelect(l)}
            className="flex items-center gap-2"
          >
            <Check
              className={`h-3.5 w-3.5 ${l === locale ? "opacity-100" : "opacity-0"}`}
            />
            <span>{localeConfig[l].name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
