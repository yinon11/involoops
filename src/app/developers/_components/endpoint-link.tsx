import Link from "next/link";
import { swaggerUiUrl, type ApiTag, type HttpMethod } from "./anchor";

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100",
  POST: "bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100",
  PATCH: "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100",
  PUT: "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100",
  DELETE: "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100",
};

/**
 * Inline "POST /v1/customers" pill that deep-links into Swagger UI at
 * the matching operation. Use anywhere an endpoint is mentioned in prose
 * so the reader can jump straight to the live, try-it-able definition.
 */
export function EndpointLink({
  method,
  path,
  tag,
  showVersion = true,
}: {
  method: HttpMethod;
  path: string;
  tag: ApiTag;
  showVersion?: boolean;
}) {
  const display = showVersion ? `/v1${path}` : path;
  return (
    <Link
      href={swaggerUiUrl(tag, method, path)}
      className="not-prose inline-flex items-center gap-1.5 rounded-md ring-1 px-1.5 py-0.5 align-middle font-mono text-[11px] no-underline transition-colors"
      title="Open in API reference (Swagger UI)"
    >
      <span
        className={`inline-flex shrink-0 rounded px-1 font-mono text-[10px] font-bold ring-1 ${METHOD_COLORS[method]}`}
      >
        {method}
      </span>
      <span className="text-slate-700">{display}</span>
    </Link>
  );
}
