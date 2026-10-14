import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { getGuideArticle, listGuideArticles } from "@/lib/user-guide";
import { GuideMarkdown } from "../../_components/guide-markdown";
import { GuideNav } from "../guide-nav";

interface Props {
  params: Promise<{ slug: string[] }>;
}

export async function generateStaticParams() {
  return listGuideArticles().map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = getGuideArticle(slug);
  if (!article) return { title: "User guide" };
  return buildMetadata({
    path: article.href,
    localized: false,
    copy: {
      en: {
        title: `${article.title} — InvoLoops user guide`,
        description: article.lede || article.title,
      },
      he: {
        title: `${article.title} — InvoLoops user guide`,
        description: article.lede || article.title,
      },
    },
  });
}

export default async function UserGuideArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = getGuideArticle(slug);
  if (!article) notFound();
  const articles = listGuideArticles();
  const index = articles.findIndex((a) => a.href === article.href);
  const prev = index > 0 ? articles[index - 1] : null;
  const next = index >= 0 && index < articles.length - 1 ? articles[index + 1] : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-8 lg:flex-row lg:px-12">
      <aside className="lg:w-64 lg:shrink-0">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Link href="/developers/guide" className="hover:text-slate-900">
            User guide
          </Link>
        </p>
        <GuideNav articles={articles} currentHref={article.href} />
      </aside>
      <article className="min-w-0 flex-1 pb-16">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          {article.sectionTitle}
        </p>
        <GuideMarkdown source={article.markdown} />
        <nav className="mt-12 flex flex-col gap-3 border-t border-slate-200 pt-6 text-sm sm:flex-row sm:justify-between">
          {prev ? (
            <Link href={prev.href} className="text-indigo-700 hover:text-indigo-500">
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={next.href} className="text-indigo-700 hover:text-indigo-500 sm:text-right">
              {next.title} →
            </Link>
          ) : null}
        </nav>
      </article>
    </div>
  );
}
