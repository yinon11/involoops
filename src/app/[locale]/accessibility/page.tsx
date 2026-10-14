import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, localePath } from "@/lib/seo/metadata";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/accessibility",
    copy: {
      en: {
        title: "Accessibility statement",
        description:
          "InvoLoops accessibility tools and contact route. Adjust text size, contrast, motion, and more from the in-app accessibility menu — your choices apply for the session.",
      },
      he: {
        title: "הצהרת נגישות",
        description:
          "כלי הנגישות של InvoLoops וערוץ יצירת הקשר. כיוונו גודל טקסט, ניגודיות, תנועה ועוד מתפריט הנגישות באפליקציה — הבחירות שלכם נשמרות לסשן.",
      },
    },
  });
}

export default async function AccessibilityPage() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = dict.accessibilityPage;
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-4 text-muted-foreground leading-relaxed">
        {t.intro}
      </p>
      <p className="mt-4 text-muted-foreground leading-relaxed">
        {t.barriers}
      </p>
      <p className="mt-8">
        <Link href={localePath("/", locale)} className="text-primary underline underline-offset-4">
          {t.backHome}
        </Link>
      </p>
    </div>
  );
}
