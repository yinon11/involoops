"use client";

import { useState } from "react";
import Link from "next/link";
import { Code2, Check, Copy, ExternalLink } from "lucide-react";
import { swaggerUiUrl, type ApiTag, type HttpMethod } from "./anchor";

interface Props {
  language: string;
  code: string;
  /**
   * If supplied, an "Open in reference →" button is shown that deep-links
   * into the Swagger UI reference at the matching operation.
   */
  endpoint?: {
    method: HttpMethod;
    path: string;
    tag: ApiTag;
  };
  caption?: string;
}

/**
 * Code sample with header (language + copy button + optional
 * "Open in reference" deep-link) and a syntax-coloured monospace body.
 *
 * Intentionally tiny — no syntax highlighter dependency. The colour
 * comes from the dark background and slate-100 text, which reads well
 * for shell + JSON without forcing tokenisation overhead onto the page.
 */
export function CodeBlock({ language, code, endpoint, caption }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on insecure contexts; silently no-op.
    }
  }

  return (
    <figure className="my-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-800/60 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-mono uppercase tracking-wide text-slate-300">
          <Code2 className="h-3.5 w-3.5" /> {language}
        </span>
        <div className="flex items-center gap-1">
          {endpoint && (
            <Link
              href={swaggerUiUrl(
                endpoint.tag,
                endpoint.method,
                endpoint.path,
              )}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-indigo-300 hover:bg-slate-700/60 hover:text-indigo-200"
              title={`Open ${endpoint.method} ${endpoint.path} in the reference`}
            >
              <ExternalLink className="h-3 w-3" />
              Open in reference
            </Link>
          )}
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700/60 hover:text-white"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> Copy
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="m-0 overflow-x-auto p-4 text-[13px] leading-relaxed text-slate-100">
        <code className="font-mono">{code}</code>
      </pre>
      {caption && (
        <figcaption className="border-t border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-slate-400">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
