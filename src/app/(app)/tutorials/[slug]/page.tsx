import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n";
import { getTutorialBySlug, tutorials } from "../tutorials";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tutorial = getTutorialBySlug(slug);
  if (!tutorial) return { title: "Tutorial" };
  const dict = await getDictionary();
  return { title: dict.tutorials.items[tutorial.key].title };
}

export function generateStaticParams() {
  return tutorials.map(({ slug }) => ({ slug }));
}

const BULLET_PREFIX = /^\s*•\s+/;

function renderBody(body: string) {
  const blocks = body.split(/\n\s*\n/);
  return blocks.map((block, i) => {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const allBullets = lines.length > 0 && lines.every((l) => BULLET_PREFIX.test(l));
    if (allBullets) {
      return (
        <ul
          key={i}
          className="mt-3 space-y-1.5 list-disc ps-5 leading-relaxed text-muted-foreground"
        >
          {lines.map((l, j) => (
            <li key={j}>{l.replace(BULLET_PREFIX, "")}</li>
          ))}
        </ul>
      );
    }
    return (
      <p
        key={i}
        className="mt-3 leading-relaxed text-muted-foreground first:mt-2"
      >
        {block}
      </p>
    );
  });
}

export default async function TutorialDetailPage({ params }: Props) {
  const { slug } = await params;
  const tutorial = getTutorialBySlug(slug);
  if (!tutorial) {
    notFound();
  }

  const dict = await getDictionary();
  const t = dict.tutorials;
  const item = t.items[tutorial.key];
  const sections = Object.values(item.sections);

  return (
    <article className="mx-auto max-w-3xl">
      <nav className="mb-6 text-sm">
        <Link
          href="/tutorials"
          className="text-muted-foreground hover:text-foreground"
        >
          ← {t.backToList}
        </Link>
      </nav>

      <header className="mb-8 border-b pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{item.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {format(t.minutes, { count: item.minutes })}
        </p>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">
          {item.summary}
        </p>
      </header>

      <div className="space-y-8">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xl font-semibold tracking-tight">
              {section.heading}
            </h2>
            {renderBody(section.body)}
          </section>
        ))}
      </div>
    </article>
  );
}
