import Link from "next/link";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children }) => {
    const className = "font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-500";
    if (href?.startsWith("/")) {
      return (
        <Link href={href} className={className}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} className={className} rel="noreferrer">
        {children}
      </a>
    );
  },
  h1: ({ children }) => (
    <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 scroll-mt-20 text-xl font-semibold tracking-tight text-slate-900">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-base font-semibold text-slate-900">{children}</h3>
  ),
  p: ({ children }) => <p className="mt-4 leading-7 text-slate-700">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5 text-slate-700">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5 text-slate-700">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-900">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-slate-100 px-3 py-2 align-top text-slate-700">{children}</td>
  ),
  code: ({ children, className }) => {
    if (className) {
      return <code className={`${className} text-slate-100`}>{children}</code>;
    }
    return <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em] text-slate-800">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-md bg-slate-900 px-4 py-3 text-xs">{children}</pre>
  ),
};

export function GuideMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  );
}
