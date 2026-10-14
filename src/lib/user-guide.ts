import fs from "node:fs";
import path from "node:path";

/**
 * The product guide has one copy: the markdown files in `docs/user-guide`.
 * `/developers/guide` renders those files. The API reference stays on
 * `/developers` (and the OpenAPI spec). Neither side restates the other.
 */

const GUIDE_ROOT = path.join(process.cwd(), "docs", "user-guide");

export const GUIDE_SECTIONS: { dir: string; title: string }[] = [
  { dir: "01-getting-started", title: "Getting started" },
  { dir: "02-expenses", title: "Expenses" },
  { dir: "03-income-studio", title: "Income Studio" },
  { dir: "04-israeli-tax-compliance", title: "Israeli tax compliance" },
  { dir: "05-dashboards-reports", title: "Dashboards and reports" },
  { dir: "06-team-and-access", title: "Team and access" },
  { dir: "07-settings-and-billing", title: "Settings and billing" },
  { dir: "08-integrations-api", title: "Integrations" },
  { dir: "09-help", title: "Help" },
];

export interface GuideArticle {
  /** Path segments under docs/user-guide, without `.md`. */
  slug: string[];
  href: string;
  sectionDir: string;
  sectionTitle: string;
  title: string;
  lede: string;
  /** Markdown with links rewritten to site paths. */
  markdown: string;
}

function sectionTitle(dir: string): string {
  return GUIDE_SECTIONS.find((s) => s.dir === dir)?.title ?? dir;
}

function insideGuide(abs: string): boolean {
  const root = path.resolve(GUIDE_ROOT);
  const resolved = path.resolve(abs);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function rewriteLinks(markdown: string, sectionDir: string): string {
  return markdown.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (full, text: string, href: string) => {
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("/") ||
        href.startsWith("#") ||
        href.startsWith("mailto:")
      ) {
        return full;
      }
      const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
      const file = hash ? href.slice(0, href.indexOf("#")) : href;
      if (!file.endsWith(".md")) return full;
      const rel = path.posix.normalize(path.posix.join(sectionDir, file));
      if (rel.startsWith("..") || path.isAbsolute(rel)) return full;
      const slug = rel.replace(/\.md$/, "");
      return `[${text}](/developers/guide/${slug}${hash})`;
    },
  );
}

function prepareMarkdown(markdown: string, sectionDir: string): string {
  const withPictures = markdown.replace(
    /<!--\s*screenshot:\s*([\s\S]*?)\s*-->/g,
    (_m, desc: string) =>
      `\n\n> **Screenshot:** ${desc.trim().replace(/\s+/g, " ")}\n\n`,
  );
  return rewriteLinks(withPictures, sectionDir);
}

function parseArticle(sectionDir: string, filename: string, raw: string): GuideArticle {
  const file = filename.replace(/\.md$/, "");
  const title =
    raw.match(/^#\s+(.+)\s*$/m)?.[1]?.trim() ?? file;
  const lede = raw.match(/^\*([^*\n]+)\*\s*$/m)?.[1]?.trim() ?? "";
  const slug = [sectionDir, file];
  return {
    slug,
    href: `/developers/guide/${slug.join("/")}`,
    sectionDir,
    sectionTitle: sectionTitle(sectionDir),
    title,
    lede,
    markdown: prepareMarkdown(raw, sectionDir),
  };
}

export function listGuideArticles(): GuideArticle[] {
  const articles: GuideArticle[] = [];
  if (!fs.existsSync(GUIDE_ROOT)) return articles;
  for (const section of GUIDE_SECTIONS) {
    const dir = path.join(GUIDE_ROOT, section.dir);
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort();
    for (const name of files) {
      const abs = path.join(dir, name);
      if (!insideGuide(abs)) continue;
      const raw = fs.readFileSync(abs, "utf8");
      articles.push(parseArticle(section.dir, name, raw));
    }
  }
  return articles;
}

export function getGuideArticle(slug: string[]): GuideArticle | null {
  if (slug.length !== 2) return null;
  if (slug.some((part) => part.includes("..") || part.includes("/") || part.includes("\\"))) {
    return null;
  }
  const rel = path.join(slug[0], `${slug[1]}.md`);
  const abs = path.join(GUIDE_ROOT, rel);
  if (!insideGuide(abs) || !fs.existsSync(abs)) return null;
  return parseArticle(slug[0], `${slug[1]}.md`, fs.readFileSync(abs, "utf8"));
}
