"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    __cc_showPreferences?: () => void;
  }
}

function gtagConsent(type: "default" | "update", params: Record<string, string>) {
  window.dataLayer = window.dataLayer || [];
  function gtag(...args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  }
  gtag("consent", type, params);
}

const DENIED_ALL = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  functionality_storage: "granted",
  security_storage: "granted",
};

const GRANTED_ANALYTICS = {
  analytics_storage: "granted",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  functionality_storage: "granted",
  security_storage: "granted",
};

const GRANTED_ANALYTICS_AND_ADS = {
  analytics_storage: "granted",
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  functionality_storage: "granted",
  security_storage: "granted",
};

const GRANTED_ADS_ONLY = {
  analytics_storage: "denied",
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  functionality_storage: "granted",
  security_storage: "granted",
};

function resolveConsent(categories: string[]) {
  const hasAnalytics = categories.includes("analytics");
  const hasAds = categories.includes("advertising");
  if (hasAnalytics && hasAds) return GRANTED_ANALYTICS_AND_ADS;
  if (hasAnalytics) return GRANTED_ANALYTICS;
  if (hasAds) return GRANTED_ADS_ONLY;
  return DENIED_ALL;
}

export default function CookieConsentProvider() {
  const pathname = usePathname();
  const { locale } = useI18n();

  useEffect(() => {
    gtagConsent("default", DENIED_ALL);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cc: any = null;

    async function initConsent() {
      const mod = await import("vanilla-cookieconsent");
      const CookieConsent = mod.default ?? mod;
      cc = CookieConsent;

      await CookieConsent.run({
        cookie: {
          name: "cc_cookie",
          expiresAfterDays: 365,
        },
        revision: 2,
        onConsent: ({ cookie }) => {
          gtagConsent("update", resolveConsent(cookie.categories));
        },
        onChange: ({ cookie }) => {
          gtagConsent("update", resolveConsent(cookie.categories));
        },
        guiOptions: {
          consentModal: {
            layout: "bar inline",
            position: "bottom",
            equalWeightButtons: false,
            flipButtons: false,
          },
          preferencesModal: {
            layout: "box",
            equalWeightButtons: true,
            flipButtons: false,
          },
        },
        categories: {
          necessary: {
            enabled: true,
            readOnly: true,
          },
          analytics: {
            enabled: false,
            autoClear: {
              cookies: [
                { name: /^_ga/ },
                { name: "_gid" },
                { name: "_gat" },
                { name: /^_clck/ },
                { name: /^_clsk/ },
              ],
            },
          },
          advertising: {
            enabled: false,
            autoClear: {
              cookies: [
                { name: "_fbp" },
                { name: "fr" },
                { name: /^_gcl_/ },
              ],
            },
          },
        },
        language: {
          default: locale,
          translations: {
            en: {
              consentModal: {
                title: "Cookies",
                description:
                  'We use cookies to run the site and, with your consent, to measure traffic via analytics. <a href="/privacy" class="cc__link">Privacy &amp; cookies</a>.',
                acceptAllBtn: "Accept all",
                acceptNecessaryBtn: "Essential only",
                showPreferencesBtn: "Preferences",
              },
              preferencesModal: {
                title: "Cookie preferences",
                acceptAllBtn: "Accept all",
                acceptNecessaryBtn: "Essential only",
                savePreferencesBtn: "Save preferences",
                closeIconLabel: "Close",
                serviceCounterLabel: "Service|Services",
                sections: [
                  {
                    title: "How we use cookies",
                    description:
                      'Necessary cookies are always on. Analytics cookies help us improve the product. See our <a href="/privacy" class="cc__link">privacy and cookie notice</a>.',
                  },
                  {
                    title: "Strictly necessary",
                    description:
                      "Required for security, sign-in, and basic navigation. They do not require consent.",
                    linkedCategory: "necessary",
                  },
                  {
                    title: "Analytics",
                    description:
                      "Helps us understand usage (e.g. via Google Analytics and Microsoft Clarity, loaded through Google Tag Manager). Data is aggregated.",
                    linkedCategory: "analytics",
                  },
                  {
                    title: "Advertising",
                    description:
                      "Used for conversion measurement, audience building, and retargeting on advertising platforms such as Meta (Facebook Pixel) and Google Ads.",
                    linkedCategory: "advertising",
                  },
                  {
                    title: "Questions",
                    description:
                      'You can change your choice anytime via “Preferences” in the cookie banner. For questions, see <a href="/privacy" class="cc__link">Privacy</a>.',
                  },
                ],
              },
            },
            he: {
              consentModal: {
                title: "קובצי Cookie",
                description:
                  'אנחנו משתמשים בקובצי Cookie להפעלת האתר, ובהסכמתך גם למדידת תנועה באמצעות אנליטיקה. <a href="/privacy" class="cc__link">פרטיות ו-Cookie</a>.',
                acceptAllBtn: "אישור הכול",
                acceptNecessaryBtn: "הכרחיים בלבד",
                showPreferencesBtn: "העדפות",
              },
              preferencesModal: {
                title: "העדפות קובצי Cookie",
                acceptAllBtn: "אישור הכול",
                acceptNecessaryBtn: "הכרחיים בלבד",
                savePreferencesBtn: "שמירת ההעדפות",
                closeIconLabel: "סגירה",
                serviceCounterLabel: "שירות|שירותים",
                sections: [
                  {
                    title: "כיצד אנו משתמשים בקובצי Cookie",
                    description:
                      'קובצי Cookie הכרחיים פעילים תמיד. קובצי Cookie אנליטיים עוזרים לנו לשפר את המוצר. ראה את <a href="/privacy" class="cc__link">הודעת הפרטיות וה־Cookie שלנו</a>.',
                  },
                  {
                    title: "הכרחיים בהחלט",
                    description:
                      "נדרשים לאבטחה, להתחברות ולניווט בסיסי. אינם דורשים הסכמה.",
                    linkedCategory: "necessary",
                  },
                  {
                    title: "אנליטיקה",
                    description:
                      "עוזרים לנו להבין את אופן השימוש (למשל דרך Google Analytics ו-Microsoft Clarity, הנטענים באמצעות Google Tag Manager). הנתונים מוצגים במצטבר.",
                    linkedCategory: "analytics",
                  },
                  {
                    title: "פרסום",
                    description:
                      "משמשים למדידת המרות, לבניית קהלים ולרימרקטינג בפלטפורמות פרסום כגון Meta (Facebook Pixel) ו-Google Ads.",
                    linkedCategory: "advertising",
                  },
                  {
                    title: "שאלות",
                    description:
                      'ניתן לשנות את הבחירה בכל עת דרך "העדפות" בבאנר ה-Cookie. לשאלות, ראה <a href="/privacy" class="cc__link">פרטיות</a>.',
                  },
                ],
              },
            },
          },
        },
      });
    }

    void initConsent();

    window.__cc_showPreferences = () => cc?.showPreferences();
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.dataLayer) return;
    // Only emit the custom pageview event when the user has granted analytics
    // consent. GTM tags rely on Consent Mode v2 (set above), but any custom
    // tag triggered on this `pageview` event would otherwise bypass a decline
    // or partial decline.
    let analyticsGranted = false;
    try {
      const raw =
        typeof document !== "undefined"
          ? document.cookie
              .split("; ")
              .find((c) => c.startsWith("cc_cookie="))
              ?.split("=")[1]
          : undefined;
      if (raw) {
        const parsed = JSON.parse(decodeURIComponent(raw)) as {
          categories?: string[];
        };
        analyticsGranted = parsed.categories?.includes("analytics") ?? false;
      }
    } catch {
      analyticsGranted = false;
    }
    if (!analyticsGranted) return;
    window.dataLayer.push({ event: "pageview", page: pathname });
  }, [pathname]);

  return null;
}
