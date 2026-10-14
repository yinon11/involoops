import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { GUIDE_SECTIONS, listGuideArticles } from "@/lib/user-guide";
import { GuideNav } from "./guide-nav";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/developers/guide",
    localized: false,
    copy: {
      en: {
        title: "User guide — InvoLoops",
        description:
          "How to record expenses, issue Israeli tax documents, connect to the Tax Authority, and invite your accountant. The same articles the product ships.",
      },
      he: {
        title: "User guide — InvoLoops",
        description:
          "How to record expenses, issue Israeli tax documents, connect to the Tax Authority, and invite your accountant.",
      },
    },
  });
}

export default function UserGuideIndexPage() {
  const articles = listGuideArticles();
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-8 lg:flex-row lg:px-12">
      <aside className="lg:w-64 lg:shrink-0">
        <GuideNav articles={articles} currentHref="/developers/guide" />
      </aside>
      <main className="min-w-0 flex-1 pb-16">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          User guide
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Using InvoLoops
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-7 text-slate-600">
          These articles are the product guide. They are written once, in the
          repository, and this page renders them. The{" "}
          <Link href="/developers" className="font-medium text-indigo-700 underline">
            API reference
          </Link>{" "}
          is the other half of the same docs site — endpoints are not repeated here.
        </p>
        <div className="mt-10 space-y-10">
          {GUIDE_SECTIONS.map((section) => {
            const items = articles.filter((a) => a.sectionDir === section.dir);
            if (items.length === 0) return null;
            return (
              <section key={section.dir}>
                <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
                <ul className="mt-3 space-y-3">
                  {items.map((article) => (
                    <li key={article.href}>
                      <Link href={article.href} className="font-medium text-indigo-700 hover:text-indigo-500">
                        {article.title}
                      </Link>
                      {article.lede ? (
                        <p className="mt-1 text-sm leading-6 text-slate-600">{article.lede}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
