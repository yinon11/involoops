import type { Metadata } from "next";
import Link from "next/link";
import {
  KeyRound,
  Repeat,
  ScrollText,
  Webhook,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { DevsSidebar } from "./_components/sidebar";
import { CodeBlock } from "./_components/code-block";
import { EndpointLink } from "./_components/endpoint-link";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/developers",
    localized: false,
    copy: {
      en: {
        title: "Developers — InvoLoops REST API",
        description:
          "REST API to create, issue, send, and manage invoices in InvoLoops. Bearer-key authentication, RFC-7807 errors, cursor pagination, idempotent writes, OpenAPI 3.1 reference.",
      },
      he: {
        title: "Developers — InvoLoops REST API",
        description:
          "REST API להפקה, חתימה, שליחה וניהול של חשבוניות ב־InvoLoops. אימות Bearer key, שגיאות RFC-7807, pagination בעזרת cursor, כתיבה אידמפוטנטית, מסמכי OpenAPI 3.1.",
      },
    },
  });
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost:3000";

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    {
      "@type": "ListItem",
      position: 2,
      name: "Developers",
      item: `${SITE_URL}/developers`,
    },
  ],
};

const safeJson = (obj: unknown) =>
  JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

export default function DevelopersPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col lg:flex-row">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(breadcrumbJsonLd) }}
      />
      <DevsSidebar />

      <main className="min-w-0 flex-1 px-4 pb-20 pt-8 sm:px-8 lg:px-12">
        {/* Hero ----------------------------------------------------------- */}
        <header className="mb-12">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
            <Sparkles className="h-3 w-3" /> InvoLoops Developer Docs
          </p>
          <h1
            data-highlight="developers-hero"
            className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl"
          >
            Build on the InvoLoops API
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Issue legal invoices, manage customers and templates, and listen
            for lifecycle events — all via a single bearer-authenticated REST
            surface.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/developers/swagger"
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
            >
              Open the API reference
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/developers/guide"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              User guide
            </Link>
            <Link
              href="/settings/api-keys"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <KeyRound className="h-4 w-4" />
              Get an API key
            </Link>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 mb-14">
          <FeatureCard
            icon={<KeyRound className="h-5 w-5" />}
            title="Bearer-key auth"
            body="One header. Per-key scopes, live/test modes, instant revoke."
          />
          <FeatureCard
            icon={<Repeat className="h-5 w-5" />}
            title="Idempotent writes"
            body="Idempotency-Key on every POST. Safe to retry under load."
          />
          <FeatureCard
            icon={<ScrollText className="h-5 w-5" />}
            title="Compliance built in"
            body="Gapless numbering, signed audit log, Spec-04 immutability — all enforced server-side."
          />
          <FeatureCard
            icon={<Webhook className="h-5 w-5" />}
            title="Webhooks"
            body="HMAC-signed deliveries for every invoice + extraction lifecycle event."
          />
        </div>

        {/* Quickstart ----------------------------------------------------- */}
        <Section id="quickstart" title="Quickstart">
          <P>
            Generate an API key in{" "}
            <DocLink href="/settings/api-keys">Settings → API keys</DocLink>.
            Pick <Strong>Test</Strong> mode for development; switch to{" "}
            <Strong>Live</Strong> when you&apos;re ready to issue real invoices.
          </P>

          <Step
            n={1}
            title="Create a customer."
            endpoint={<EndpointLink method="POST" path="/customers" tag="Customers" />}
          >
            <CodeBlock
              language="bash"
              endpoint={{ method: "POST", path: "/customers", tag: "Customers" }}
              code={`curl https://involoops.com/api/v1/customers \\
  -H "Authorization: Bearer inv_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 01HX5XYZ-create-acme-001" \\
  -d '{
    "name": "Acme Ltd",
    "email": "billing@acme.example",
    "tax_id": "514999999"
  }'`}
            />
          </Step>

          <Step
            n={2}
            title="Create a draft invoice."
            endpoint={
              <EndpointLink method="POST" path="/outbound-invoices" tag="Outbound invoices" />
            }
          >
            <P>
              The gapless document number is allocated immediately, so the
              response includes <Code>formatted_number</Code> like{" "}
              <Code>2026-TI-000001</Code>.
            </P>
            <CodeBlock
              language="bash"
              endpoint={{ method: "POST", path: "/outbound-invoices", tag: "Outbound invoices" }}
              code={`curl https://involoops.com/api/v1/outbound-invoices \\
  -H "Authorization: Bearer $INVOLOOPS_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "document_type": "TAX_INVOICE",
    "customer_id": "<customer-uuid>",
    "invoice_date": "2026-04-20",
    "items": [
      { "description": "Consulting — April",
        "quantity": 10, "unitPrice": 450, "total": 4500 }
    ],
    "subtotal": "4500.00",
    "vat_rate": "18",
    "vat_amount": "810.00",
    "total": "5310.00",
    "currency": "ILS"
  }'`}
            />
          </Step>

          <Step
            n={3}
            title="Issue (sign) the invoice."
            endpoint={
              <EndpointLink
                method="POST"
                path="/outbound-invoices/{id}/issue"
                tag="Outbound invoices"
              />
            }
          >
            <P>
              The PDF is generated, the canonical JSON + PDF are archived to
              immutable storage, and (where applicable) the invoice is
              submitted to ITA / SHAAM for allocation.
            </P>
            <CodeBlock
              language="bash"
              endpoint={{
                method: "POST",
                path: "/outbound-invoices/{id}/issue",
                tag: "Outbound invoices",
              }}
              code={`curl -X POST \\
  https://involoops.com/api/v1/outbound-invoices/<id>/issue \\
  -H "Authorization: Bearer $INVOLOOPS_KEY" \\
  -H "Idempotency-Key: $(uuidgen)"`}
            />
          </Step>

          <Step n={4} title="Email it to the customer.">
            <P>
              Use{" "}
              <EndpointLink
                method="POST"
                path="/outbound-invoices/{id}/send"
                tag="Outbound invoices"
              />{" "}
              — the recipient gets a 7-day signed PDF download link; status
              transitions to <Code>sent</Code>. Then mark it paid with{" "}
              <EndpointLink
                method="POST"
                path="/outbound-invoices/{id}/mark-paid"
                tag="Outbound invoices"
              />
              , or fetch the signed PDF URL with{" "}
              <EndpointLink
                method="GET"
                path="/outbound-invoices/{id}/pdf"
                tag="Outbound invoices"
              />
              .
            </P>
          </Step>

          <Step n={5} title="Issue a credit note">
            <P>
              if you need to reverse (fully or partially):{" "}
              <EndpointLink
                method="POST"
                path="/outbound-invoices/{id}/credit-note"
                tag="Outbound invoices"
              />{" "}
              with <Code>{"{ amount, reason }"}</Code>. Allocates a fresh{" "}
              <Code>CREDIT_INVOICE</Code> sequence; voids the original when
              remaining reaches zero.
            </P>
          </Step>
        </Section>

        {/* Auth ------------------------------------------------------------ */}
        <Section id="auth" title="Authentication">
          <P>
            Every call requires{" "}
            <Code>Authorization: Bearer &lt;api-key&gt;</Code>. Keys carry one
            of two prefixes:
          </P>
          <UL>
            <li>
              <Code>inv_live_…</Code> — production. Mutates real records, sends
              real email, calls SHAAM live.
            </li>
            <li>
              <Code>inv_test_…</Code> — sandbox. Side effects are skipped or
              mocked.
            </li>
          </UL>
          <P>
            Each key is scoped. Routes refuse anything not in the key&apos;s
            scope set with <Code>403 missing_scope</Code>. Available scopes are
            listed under <Code>AvailableScope</Code> in the reference.
          </P>
          <Aside>
            Identify the calling key with{" "}
            <EndpointLink method="GET" path="/me" tag="Meta" /> — useful for
            sanity-checking which scopes a key actually carries before you
            roll it into production.
          </Aside>
        </Section>

        {/* MCP ------------------------------------------------------------ */}
        <Section id="mcp" title="MCP (AI clients)">
          <P>
            InvoLoops also exposes a{" "}
            <a
              href="https://modelcontextprotocol.io/"
              className="text-indigo-600 underline-offset-2 hover:underline"
            >
              Model Context Protocol
            </a>{" "}
            endpoint at <Code>/api/mcp</Code>. Use the same bearer API key;
            tools enforce the same scopes as the REST routes.
          </P>
          <CodeBlock
            language="json"
            code={`{
  "mcpServers": {
    "involoops": {
      "url": "https://involoops.com/api/mcp",
      "headers": {
        "Authorization": "Bearer inv_live_…"
      }
    }
  }
}`}
          />
          <P>
            Tools cover business status / expense analytics (
            <Code>invoices:read</Code>
            ), customers, templates, vendors (list), and the outbound invoice
            lifecycle (draft → update draft → issue → send / mark-paid / void /
            delete draft / credit note / PDF URL). Full
            catalog: <Code>docs/api/10-mcp.md</Code> in the repo.
          </P>
        </Section>

        {/* Errors ---------------------------------------------------------- */}
        <Section id="errors" title="Errors (RFC 7807)">
          <P>
            Errors are{" "}
            <a
              href="https://datatracker.ietf.org/doc/html/rfc7807"
              className="text-indigo-600 underline-offset-2 hover:underline"
            >
              Problem Details
            </a>{" "}
            objects served as <Code>application/problem+json</Code>:
          </P>
          <CodeBlock
            language="json"
            code={`{
  "type": "https://involoops.com/developers#errors",
  "title": "Request body failed validation",
  "status": 422,
  "code": "validation_failed",
  "request_id": "01HX5...",
  "errors": [
    { "path": "items.0.quantity", "message": "must be > 0" }
  ]
}`}
          />
          <P>
            Always log <Code>request_id</Code> when you contact support — one
            line in our logs covers the full request.
          </P>
        </Section>

        {/* Idempotency ----------------------------------------------------- */}
        <Section id="idempotency" title="Idempotency">
          <P>
            Every state-creating <Code>POST</Code> requires an{" "}
            <Code>Idempotency-Key</Code> header (8–255 chars,{" "}
            <Code>[A-Za-z0-9_-]</Code> — UUID or ULID is fine). Replays within
            24h with the same body return the original response verbatim.
            Reusing a key with a <em>different</em> body returns{" "}
            <Code>409 idempotency_replay_mismatch</Code> — that&apos;s a bug
            in your code, not ours.
          </P>
        </Section>

        {/* Pagination ------------------------------------------------------ */}
        <Section id="pagination" title="Pagination">
          <P>List endpoints return cursor-paginated envelopes:</P>
          <CodeBlock
            language="json"
            code={`{
  "data": [ ... ],
  "page": {
    "next_cursor": "eyJrIjoiLi4uIn0",
    "has_more": true,
    "limit": 50
  }
}`}
          />
          <P>
            Default <Code>limit</Code> is 50, max 200. Pass{" "}
            <Code>?cursor=&lt;next_cursor&gt;</Code> to fetch the next page.
            Cursors are opaque — don&apos;t parse them.
          </P>
        </Section>

        {/* Rate limits ----------------------------------------------------- */}
        <Section id="rate-limits" title="Rate limits">
          <P>
            Each key has its own bucket: <Strong>60 requests/sec</Strong>{" "}
            (burst) and <Strong>1,000 requests/minute</Strong> (sustained).
            Rejected calls return <Code>429 rate_limited</Code> with a{" "}
            <Code>Retry-After</Code> header. Honor it — retrying tighter only
            prolongs the freeze.
          </P>
          <P>
            Watch the response headers: <Code>X-RateLimit-Limit</Code>,{" "}
            <Code>X-RateLimit-Remaining</Code>, and{" "}
            <Code>X-RateLimit-Burst-Remaining</Code>.
          </P>
        </Section>

        {/* Uploads --------------------------------------------------------- */}
        <Section id="uploads" title="Uploads (inbound extraction)">
          <P>
            Offload PDF / image intake to InvoLoops. Three steps: ask for a
            presigned URL, PUT the bytes directly to S3, then tell us to
            extract. Asynchronous — the extraction runs in a background
            worker; subscribe to <Code>invoice.processed</Code> to get the
            result.
          </P>
          <CodeBlock
            language="bash"
            endpoint={{ method: "POST", path: "/uploads", tag: "Uploads" }}
            code={`# 1. Get a presigned upload URL + upload_id.
curl https://involoops.com/api/v1/uploads \\
  -H "Authorization: Bearer $INVOLOOPS_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "file_name": "vendor-receipt.pdf",
    "content_type": "application/pdf",
    "size_bytes": 182341
  }'
# → { "upload_id": "...", "upload": { "url": "https://s3...", "method": "PUT", ... } }

# 2. PUT the bytes to the S3 presigned URL. No proxy through our API —
#    your bandwidth, their CORS.
curl -X PUT "$UPLOAD_URL" \\
  -H "Content-Type: application/pdf" \\
  --data-binary @vendor-receipt.pdf

# 3. Confirm + enqueue extraction.
curl -X POST https://involoops.com/api/v1/uploads/$UPLOAD_ID/process \\
  -H "Authorization: Bearer $INVOLOOPS_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{}'
# → 202 Accepted, status: "queued"`}
          />
          <P>When the worker finishes, a webhook fires:</P>
          <CodeBlock
            language="json"
            code={`{
  "id": "evt_01HX...",
  "type": "invoice.processed",
  "version": 1,
  "created_at": "2026-04-21T10:00:00+03:00",
  "data": {
    "upload_id": "<upload-uuid>",
    "invoice_id": "<invoice-uuid>",
    "status": "done",
    "auto_approved": false,
    "confidence": 94
  }
}`}
          />
          <P>
            Or, if you&apos;d rather poll, hit{" "}
            <EndpointLink method="GET" path="/uploads/{id}" tag="Uploads" />{" "}
            until <Code>status</Code> is <Code>done</Code> or{" "}
            <Code>error</Code>. On terminal failure (duplicate file,
            unreadable PDF, LLM upstream outage) you&apos;ll also receive an{" "}
            <Code>invoice.processing_failed</Code> webhook.
          </P>
          <P>
            Limits: 50 MB per file, 60-page ceiling on PDFs, and the same
            monthly quota as the web app (plan-tier gated).
          </P>
        </Section>

        {/* Webhooks -------------------------------------------------------- */}
        <Section id="webhooks" title="Webhooks">
          <P>
            Subscribe to lifecycle events to stop polling. Register an
            endpoint with{" "}
            <EndpointLink
              method="POST"
              path="/webhook-endpoints"
              tag="Webhooks"
            />{" "}
            — the response includes a plaintext <Code>secret</Code> shown
            exactly once. Store it; every delivery is signed with it.
          </P>
          <CodeBlock
            language="bash"
            endpoint={{ method: "POST", path: "/webhook-endpoints", tag: "Webhooks" }}
            code={`curl https://involoops.com/api/v1/webhook-endpoints \\
  -H "Authorization: Bearer $INVOLOOPS_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "url": "https://example.com/hooks/involoops",
    "description": "Finance ops notifier",
    "events": [
      "outbound_invoice.issued",
      "outbound_invoice.paid",
      "outbound_invoice.voided"
    ]
  }'`}
          />
          <P>Every delivery carries:</P>
          <CodeBlock
            language="text"
            code={`POST /hooks/involoops HTTP/1.1
User-Agent: InvoLoops-Webhook/1.0
Content-Type: application/json; charset=utf-8
X-Involoops-Signature: t=1745151600,v1=<hex hmac-sha256>
X-Involoops-Event-Id: evt_01HX...
X-Involoops-Event-Type: outbound_invoice.issued
X-Involoops-Delivery: <delivery-uuid>
X-Involoops-Attempt: 1`}
          />
          <P>
            Verify before trusting. HMAC-SHA-256 input is{" "}
            <Code>{"`${t}.${raw_body}`"}</Code> keyed by your plaintext secret:
          </P>
          <CodeBlock
            language="javascript"
            code={`import crypto from "node:crypto";

export function verifyInvoloopsSignature(headers, rawBody, secret) {
  const sig = headers["x-involoops-signature"] ?? "";
  const parts = Object.fromEntries(
    sig.split(",").map(p => p.split("=").map(s => s.trim())),
  );
  const t = Number(parts.t);
  const sent = parts.v1;
  if (!t || !sent) return false;
  if (Math.abs(Date.now() / 1000 - t) > 300) return false; // 5-min skew window
  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest("hex");
  if (expected.length !== sent.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(sent, "hex"),
  );
}`}
          />
          <P>
            Respond with any 2xx to acknowledge. Non-2xx (or a ≥10s timeout)
            triggers retries at 30 s, 2 m, 10 m, 30 m, 2 h, 6 h, 12 h, 24 h —
            then the delivery is dead-lettered. After 50 consecutive failures
            the endpoint auto-disables; re-enable via{" "}
            <EndpointLink
              method="PATCH"
              path="/webhook-endpoints/{id}"
              tag="Webhooks"
            />{" "}
            with <Code>{'{ "active": true }'}</Code>.
          </P>
          <P>
            Event types currently published:{" "}
            <Code>
              outbound_invoice.&#123;created,issued,sent,paid,voided&#125;
            </Code>
            , <Code>customer.&#123;created,updated,deleted&#125;</Code>,{" "}
            <Code>invoice.&#123;processed,processing_failed&#125;</Code>. The
            event schema lives in the reference as{" "}
            <Code>WebhookEventEnvelope</Code>.
          </P>

          <h3 className="mt-8 mb-2 text-lg font-semibold text-slate-900">
            Testing your receiver
          </h3>
          <P>
            Fire a synthetic delivery at any of your endpoints with{" "}
            <EndpointLink
              method="POST"
              path="/webhook-endpoints/{id}/test"
              tag="Webhooks"
            />{" "}
            — the response returns the receiver&apos;s status, body snippet,
            and any error, in-band, so you can iterate without issuing real
            invoices. Test deliveries carry <Code>X-Involoops-Test: true</Code>{" "}
            and never count toward the endpoint&apos;s auto-disable counter.
          </P>
          <CodeBlock
            language="bash"
            endpoint={{
              method: "POST",
              path: "/webhook-endpoints/{id}/test",
              tag: "Webhooks",
            }}
            code={`curl -X POST \\
  https://involoops.com/api/v1/webhook-endpoints/$ENDPOINT_ID/test \\
  -H "Authorization: Bearer $INVOLOOPS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{}'
# → { "ok": true, "outcome": "delivered",
#     "response_status": 200, "response_snippet": "…" }`}
          />
        </Section>

        {/* Versioning ------------------------------------------------------ */}
        <Section id="versioning" title="Versioning">
          <P>
            URL-pathed: <Code>/api/v1/...</Code>. New optional fields ship
            within v1 without notice. Breaking changes mean v2 — and v1 stays
            online for ≥12 months after v2 GA, with <Code>Deprecation</Code>{" "}
            and <Code>Sunset</Code> response headers.
          </P>
        </Section>

        <hr className="my-12 border-slate-200" />
        <p className="text-sm text-slate-500">
          Ready to try requests live? Open the interactive{" "}
          <Link
            href="/developers/swagger"
            className="text-indigo-600 hover:underline"
          >
            API reference
          </Link>{" "}
          or download the raw{" "}
          <Link
            href="/api/v1/openapi.json"
            className="text-indigo-600 hover:underline"
          >
            OpenAPI 3.1 spec
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

// ---- Inline typography primitives ---------------------------------------
// Rebuilds the small slice of `prose` we actually use without depending on
// `@tailwindcss/typography` (which isn't installed). Keeps the layout
// readable and gives us full control over spacing/colour.

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 mb-14">
      <h2 className="group mb-4 flex items-baseline gap-2 text-2xl font-bold tracking-tight text-slate-900">
        <a
          href={`#${id}`}
          className="opacity-0 transition-opacity group-hover:opacity-100 text-slate-300 hover:text-indigo-600"
          aria-label={`Permalink to ${title}`}
        >
          #
        </a>
        {title}
      </h2>
      <div className="space-y-4 text-slate-700 leading-relaxed">{children}</div>
    </section>
  );
}

function Step({
  n,
  title,
  endpoint,
  children,
}: {
  n: number;
  title: string;
  endpoint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-10 pb-2">
      <span className="absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
        {n}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="text-base font-semibold text-slate-900">{title}</span>
        {endpoint}
      </div>
      <div className="space-y-3 text-slate-700">{children}</div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px]">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[15px] marker:text-slate-400">
      {children}
    </ul>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800 ring-1 ring-slate-200">
      {children}
    </code>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-slate-900">{children}</strong>;
}

function DocLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-indigo-600 underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

function Aside({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4 text-sm text-slate-700">
      {children}
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2 text-indigo-600">
        {icon}
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  );
}
