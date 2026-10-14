import Link from "next/link";
import { GUIDE_SECTIONS, type GuideArticle } from "@/lib/user-guide";

export function GuideNav({
  articles,
  currentHref,
}: {
  articles: GuideArticle[];
  currentHref?: string;
}) {
  return (
    <nav className="space-y-6 text-sm">
      {GUIDE_SECTIONS.map((section) => {
        const items = articles.filter((a) => a.sectionDir === section.dir);
        if (items.length === 0) return null;
        return (
          <div key={section.dir}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {section.title}
            </p>
            <ul className="space-y-1">
              {items.map((article) => {
                const active = article.href === currentHref;
                return (
                  <li key={article.href}>
                    <Link
                      href={article.href}
                      className={
                        active
                          ? "font-medium text-indigo-700"
                          : "text-slate-600 hover:text-slate-900"
                      }
                    >
                      {article.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
