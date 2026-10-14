"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  KeyRound,
  AlertTriangle,
  Repeat,
  ListOrdered,
  Gauge,
  CloudUpload,
  Webhook,
  GitBranch,
  Rocket,
  Boxes,
  ChevronRight,
} from "lucide-react";
import {
  swaggerUiTagAnchor,
  swaggerUiUrl,
  type ApiTag,
  type HttpMethod,
} from "./anchor";
import { ROUTE_PATHS } from "./_routes";

interface GuideSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const GUIDE_SECTIONS: GuideSection[] = [
  { id: "quickstart", label: "Quickstart", icon: Rocket },
  { id: "auth", label: "Authentication", icon: KeyRound },
  { id: "mcp", label: "MCP", icon: Boxes },
  { id: "errors", label: "Errors (RFC 7807)", icon: AlertTriangle },
  { id: "idempotency", label: "Idempotency", icon: Repeat },
  { id: "pagination", label: "Pagination", icon: ListOrdered },
  { id: "rate-limits", label: "Rate limits", icon: Gauge },
  { id: "uploads", label: "Uploads", icon: CloudUpload },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "versioning", label: "Versioning", icon: GitBranch },
];

interface ApiOperation {
  method: HttpMethod;
  path: string;
  summary: string;
}

interface ApiSection {
  tag: ApiTag;
  operations: ApiOperation[];
}

const API_SECTIONS: ApiSection[] = [
  {
    tag: "Meta",
    operations: [
      { method: "GET", path: "/health", summary: "Liveness" },
      { method: "GET", path: "/me", summary: "Identity" },
    ],
  },
  {
    tag: "Business entity",
    operations: [
      { method: "GET", path: "/business-entity", summary: "Get entity" },
    ],
  },
  {
    tag: "Customers",
    operations: [
      { method: "GET", path: "/customers", summary: "List" },
      { method: "POST", path: "/customers", summary: "Create" },
      { method: "GET", path: "/customers/{id}", summary: "Get" },
      { method: "PATCH", path: "/customers/{id}", summary: "Update" },
      { method: "DELETE", path: "/customers/{id}", summary: "Delete" },
    ],
  },
  {
    tag: "Vendors",
    operations: [{ method: "GET", path: "/vendors", summary: "List" }],
  },
  {
    tag: "Templates",
    operations: [
      { method: "GET", path: "/invoice-templates", summary: "List" },
      { method: "POST", path: "/invoice-templates", summary: "Create" },
      { method: "GET", path: "/invoice-templates/{id}", summary: "Get" },
      { method: "PATCH", path: "/invoice-templates/{id}", summary: "Update" },
      { method: "DELETE", path: "/invoice-templates/{id}", summary: "Delete" },
    ],
  },
  {
    tag: "Outbound invoices",
    operations: [
      { method: "GET", path: "/outbound-invoices", summary: "List" },
      { method: "POST", path: "/outbound-invoices", summary: "Create draft" },
      { method: "GET", path: "/outbound-invoices/{id}", summary: "Get" },
      { method: "PATCH", path: "/outbound-invoices/{id}", summary: "Update draft" },
      { method: "DELETE", path: "/outbound-invoices/{id}", summary: "Soft-delete" },
      { method: "POST", path: "/outbound-invoices/{id}/issue", summary: "Issue (sign)" },
      { method: "POST", path: "/outbound-invoices/{id}/send", summary: "Email to recipient" },
      { method: "POST", path: "/outbound-invoices/{id}/credit-note", summary: "Issue credit note" },
      { method: "POST", path: "/outbound-invoices/{id}/mark-paid", summary: "Mark paid" },
      { method: "POST", path: "/outbound-invoices/{id}/void", summary: "Void" },
      { method: "GET", path: "/outbound-invoices/{id}/pdf", summary: "PDF download URL" },
    ],
  },
  {
    tag: "Webhooks",
    operations: [
      { method: "GET", path: "/webhook-endpoints", summary: "List endpoints" },
      { method: "POST", path: "/webhook-endpoints", summary: "Register endpoint" },
      { method: "GET", path: "/webhook-endpoints/{id}", summary: "Get" },
      { method: "PATCH", path: "/webhook-endpoints/{id}", summary: "Update" },
      { method: "DELETE", path: "/webhook-endpoints/{id}", summary: "Delete" },
      { method: "POST", path: "/webhook-endpoints/{id}/test", summary: "Test delivery" },
      { method: "POST", path: "/webhook-endpoints/{id}/rotate-secret", summary: "Rotate secret" },
    ],
  },
  {
    tag: "Uploads",
    operations: [
      { method: "POST", path: "/uploads", summary: "Create + presign" },
      { method: "GET", path: "/uploads/{id}", summary: "Status" },
      { method: "POST", path: "/uploads/{id}/process", summary: "Confirm + extract" },
    ],
  },
];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  POST: "bg-sky-50 text-sky-700 ring-sky-200",
  PATCH: "bg-amber-50 text-amber-700 ring-amber-200",
  PUT: "bg-amber-50 text-amber-700 ring-amber-200",
  DELETE: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function DevsSidebar() {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Highlight the guide section currently in view. We observe the
  // <h2 id="..."> elements and pick whichever is closest to the top of
  // the viewport (with a small offset for the sticky top bar).
  useEffect(() => {
    const headings = GUIDE_SECTIONS.map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <aside className="w-full lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-72 lg:overflow-y-auto lg:border-r lg:border-slate-200 lg:bg-slate-50/50">
      <nav className="px-4 py-6 lg:px-5">
        <div className="mb-6">
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Guide
          </p>
          <ul className="space-y-0.5">
            {GUIDE_SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = activeId === section.id;
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-indigo-50 font-medium text-indigo-700"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        active ? "text-indigo-600" : "text-slate-400"
                      }`}
                    />
                    {section.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Boxes className="h-3.5 w-3.5" />
            API reference
          </p>
          <ul className="space-y-3">
            {API_SECTIONS.map((section) => (
              <li key={section.tag}>
                <Link
                  href={`${ROUTE_PATHS.swagger}${swaggerUiTagAnchor(section.tag)}`}
                  className="flex items-center justify-between rounded-md px-2 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                >
                  {section.tag}
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                </Link>
                <ul className="mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
                  {section.operations.map((op) => (
                    <li key={`${op.method}-${op.path}`}>
                      <Link
                        href={swaggerUiUrl(section.tag, op.method, op.path)}
                        className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        title={`${op.method} ${op.path} — ${op.summary}`}
                      >
                        <span
                          className={`inline-flex w-12 shrink-0 justify-center rounded px-1 py-0.5 font-mono text-[10px] font-bold ring-1 ${
                            METHOD_COLORS[op.method]
                          }`}
                        >
                          {op.method}
                        </span>
                        <span className="truncate font-mono text-[11px] text-slate-500">
                          {op.path}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </aside>
  );
}
