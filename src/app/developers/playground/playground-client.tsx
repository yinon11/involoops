"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  KeyRound,
  Eye,
  EyeOff,
  Plug,
  UserPlus,
  Users,
  FileText,
  Send,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Plus,
  Minus,
  ExternalLink,
  Receipt,
} from "lucide-react";

/**
 * Storage key for the bearer token. We use sessionStorage rather than
 * localStorage so a closed tab clears the secret — the playground is
 * not a token vault, just a convenience for the active session.
 */
const STORAGE_KEY_TOKEN = "involoops:playground:api-key";
const STORAGE_KEY_BASE = "involoops:playground:base-url";

const DOC_TYPES = [
  { value: "TAX_INVOICE", label: "Tax Invoice", icon: FileText },
  { value: "TAX_INVOICE_RECEIPT", label: "Tax Invoice + Receipt", icon: Receipt },
  { value: "RECEIPT", label: "Receipt", icon: Receipt },
] as const;

type DocType = (typeof DOC_TYPES)[number]["value"];

const PAYMENT_METHODS = [
  "cash",
  "check",
  "card",
  "bank_transfer",
  "withholding_tax",
  "other",
] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

interface PaymentRow {
  method: PaymentMethod;
  amount: string;
  currency: string;
  date: string;
  reference: string;
}

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  created_at?: string | null;
}

interface OutboundRow {
  id: string;
  formatted_number?: string | null;
  document_type: string;
  status: string;
  total?: string | null;
  currency?: string | null;
  created_at?: string | null;
  customer_id?: string | null;
}

interface LogEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  ms: number;
  ok: boolean;
  request: { headers: Record<string, string>; body: unknown };
  response: { headers: Record<string, string>; body: unknown };
  ts: number;
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function money(n: number): string {
  return n.toFixed(2);
}

export function PlaygroundClient() {
  // ─── Connection state ─────────────────────────────────────────────────
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showToken, setShowToken] = useState(false);

  // Hydrate from sessionStorage on first mount. We read once — subsequent
  // edits write back immediately so a refresh keeps state in sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(window.sessionStorage.getItem(STORAGE_KEY_TOKEN) ?? "");
    setBaseUrl(
      window.sessionStorage.getItem(STORAGE_KEY_BASE) ??
        `${window.location.origin}/api/v1`,
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (token) window.sessionStorage.setItem(STORAGE_KEY_TOKEN, token);
    else window.sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (baseUrl) window.sessionStorage.setItem(STORAGE_KEY_BASE, baseUrl);
  }, [baseUrl]);

  // ─── Activity log ─────────────────────────────────────────────────────
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  const pushLog = useCallback((entry: LogEntry) => {
    setLog((prev) => [entry, ...prev].slice(0, 50));
  }, []);

  // ─── Generic fetch helper ─────────────────────────────────────────────
  const call = useCallback(
    async (
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string,
      body?: unknown,
    ): Promise<{ ok: boolean; status: number; data: unknown }> => {
      if (!token) {
        throw new Error("Paste your API key in the connection card first.");
      }
      const trimmedBase = baseUrl.replace(/\/+$/, "");
      const url = `${trimmedBase}${path.startsWith("/") ? path : `/${path}`}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      // Idempotency-Key is required on every state-creating POST. We send
      // it on all writes — harmless on PATCH/DELETE/GET — so the user
      // never has to remember to flip it on.
      if (method !== "GET") {
        headers["Idempotency-Key"] = newId();
      }

      const t0 = performance.now();
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Don't send the user's session cookie — we want to mimic an
        // external integration that has only the bearer key.
        credentials: "omit",
      });
      const ms = Math.round(performance.now() - t0);

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      let data: unknown = null;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json") || ct.includes("application/problem+json")) {
        try {
          data = await res.json();
        } catch {
          data = await res.text();
        }
      } else {
        data = await res.text();
      }

      pushLog({
        id: newId(),
        method,
        url,
        status: res.status,
        ms,
        ok: res.ok,
        request: { headers, body: body ?? null },
        response: { headers: responseHeaders, body: data },
        ts: Date.now(),
      });

      return { ok: res.ok, status: res.status, data };
    },
    [baseUrl, pushLog, token],
  );

  // ─── Identity ─────────────────────────────────────────────────────────
  const [me, setMe] = useState<unknown>(null);
  const [meBusy, setMeBusy] = useState(false);

  const handleWhoami = useCallback(async () => {
    setMeBusy(true);
    try {
      const r = await call("GET", "/me");
      if (r.ok) setMe(r.data);
      else setMe(null);
    } catch (err) {
      setMe(null);
      pushLog(localFailure("GET", `${baseUrl}/me`, err));
    } finally {
      setMeBusy(false);
    }
  }, [baseUrl, call, pushLog]);

  // ─── Customer state ───────────────────────────────────────────────────
  const [custForm, setCustForm] = useState({
    name: "Acme Corp",
    email: "billing@acme.test",
    phone: "",
    tax_id: "",
    address: "",
    notes: "",
  });
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customersBusy, setCustomersBusy] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  // null = never fetched, number = ms-since-epoch of the last successful list.
  // Drives the "fetched but empty" empty-state — without it we can't tell
  // "no customers yet" from "haven't pressed the button yet".
  const [customersFetchedAt, setCustomersFetchedAt] = useState<number | null>(null);
  const [customersHasMore, setCustomersHasMore] = useState(false);

  const handleCreateCustomer = useCallback(async () => {
    setCustomersBusy(true);
    try {
      const payload: Record<string, string | null> = { name: custForm.name };
      for (const k of ["email", "phone", "tax_id", "address", "notes"] as const) {
        const v = custForm[k].trim();
        if (v) payload[k] = v;
      }
      const r = await call("POST", "/customers", payload);
      if (r.ok && isCustomer(r.data)) {
        setCustomers((prev) => [r.data as CustomerRow, ...prev]);
        setSelectedCustomer((r.data as CustomerRow).id);
      }
    } catch (err) {
      pushLog(localFailure("POST", `${baseUrl}/customers`, err));
    } finally {
      setCustomersBusy(false);
    }
  }, [baseUrl, call, custForm, pushLog]);

  const handleListCustomers = useCallback(async () => {
    setCustomersBusy(true);
    try {
      const r = await call("GET", "/customers?limit=100");
      if (r.ok && isPage(r.data)) {
        setCustomers(r.data.data as CustomerRow[]);
        setCustomersFetchedAt(Date.now());
        const page = (r.data as { page?: { has_more?: boolean } }).page;
        setCustomersHasMore(Boolean(page?.has_more));
      }
    } catch (err) {
      pushLog(localFailure("GET", `${baseUrl}/customers`, err));
    } finally {
      setCustomersBusy(false);
    }
  }, [baseUrl, call, pushLog]);

  // ─── Outbound document state ──────────────────────────────────────────
  const [docType, setDocType] = useState<DocType>("TAX_INVOICE");
  const [currency, setCurrency] = useState("ILS");
  const [language, setLanguage] = useState("he");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [vatRate, setVatRate] = useState("17");
  const [items, setItems] = useState<LineItem[]>([
    { description: "Consulting hours", quantity: "10", unitPrice: "150.00" },
  ]);
  const [notes, setNotes] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([
    {
      method: "bank_transfer",
      amount: "",
      currency: "ILS",
      date: todayIso(),
      reference: "TX-001",
    },
  ]);

  const requiresPayments =
    docType === "RECEIPT" || docType === "TAX_INVOICE_RECEIPT";

  // Derived totals — computed live so the user sees what we'll submit.
  const totals = useMemo(() => {
    let subtotal = 0;
    for (const it of items) {
      const q = Number(it.quantity);
      const p = Number(it.unitPrice);
      if (Number.isFinite(q) && Number.isFinite(p)) subtotal += q * p;
    }
    const rate = Number(vatRate);
    const vatAmount = Number.isFinite(rate) ? subtotal * (rate / 100) : 0;
    const total = subtotal + vatAmount;
    return { subtotal, vatAmount, total };
  }, [items, vatRate]);

  // Keep the first payment row's amount in sync with the live total when
  // it's empty / unedited — saves a step when the user just wants to fire
  // a sanity-check receipt for the full amount.
  useEffect(() => {
    if (!requiresPayments) return;
    setPayments((prev) => {
      if (prev.length === 0) return prev;
      const first = prev[0];
      if (first.amount === "" || first.amount === "0" || first.amount === "0.00") {
        const next = [...prev];
        next[0] = { ...first, amount: money(totals.total), currency };
        return next;
      }
      return prev;
    });
  }, [requiresPayments, totals.total, currency]);

  const [outbound, setOutbound] = useState<OutboundRow[]>([]);
  const [outboundBusy, setOutboundBusy] = useState(false);
  const [lastDraft, setLastDraft] = useState<OutboundRow | null>(null);

  const handleCreateDraft = useCallback(async () => {
    setOutboundBusy(true);
    try {
      const cleanItems = items
        .filter((it) => it.description.trim() && Number(it.quantity) > 0)
        .map((it) => {
          const q = Number(it.quantity);
          const p = Number(it.unitPrice);
          return {
            description: it.description.trim(),
            quantity: q,
            unitPrice: p,
            total: Number((q * p).toFixed(2)),
          };
        });

      const body: Record<string, unknown> = {
        document_type: docType,
        invoice_date: invoiceDate,
        items: cleanItems,
        subtotal: money(totals.subtotal),
        vat_rate: vatRate,
        vat_amount: money(totals.vatAmount),
        total: money(totals.total),
        currency,
        language,
      };
      if (selectedCustomer) body.customer_id = selectedCustomer;
      if (dueDate) body.due_date = dueDate;
      if (notes.trim()) body.notes = notes.trim();
      if (requiresPayments) {
        body.payments = payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          currency: p.currency,
          date: p.date,
          ...(p.reference.trim() ? { reference: p.reference.trim() } : {}),
        }));
      }

      const r = await call("POST", "/outbound-invoices", body);
      if (r.ok && isOutbound(r.data)) {
        setLastDraft(r.data as OutboundRow);
        setOutbound((prev) => [r.data as OutboundRow, ...prev]);
      }
    } catch (err) {
      pushLog(localFailure("POST", `${baseUrl}/outbound-invoices`, err));
    } finally {
      setOutboundBusy(false);
    }
  }, [
    baseUrl,
    call,
    currency,
    docType,
    dueDate,
    invoiceDate,
    items,
    language,
    notes,
    payments,
    pushLog,
    requiresPayments,
    selectedCustomer,
    totals.subtotal,
    totals.total,
    totals.vatAmount,
    vatRate,
  ]);

  const handleIssue = useCallback(
    async (id: string) => {
      setOutboundBusy(true);
      try {
        const r = await call("POST", `/outbound-invoices/${id}/issue`, {});
        if (r.ok && isOutbound(r.data)) {
          const issued = r.data as OutboundRow;
          setOutbound((prev) =>
            prev.map((row) => (row.id === id ? { ...row, ...issued } : row)),
          );
          if (lastDraft?.id === id) {
            setLastDraft({ ...lastDraft, ...issued });
          }
        }
      } catch (err) {
        pushLog(localFailure("POST", `${baseUrl}/outbound-invoices/${id}/issue`, err));
      } finally {
        setOutboundBusy(false);
      }
    },
    [baseUrl, call, lastDraft, pushLog],
  );

  const handleListOutbound = useCallback(async () => {
    setOutboundBusy(true);
    try {
      const r = await call("GET", "/outbound-invoices?limit=25");
      if (r.ok && isPage(r.data)) {
        setOutbound(r.data.data as OutboundRow[]);
      }
    } catch (err) {
      pushLog(localFailure("GET", `${baseUrl}/outbound-invoices`, err));
    } finally {
      setOutboundBusy(false);
    }
  }, [baseUrl, call, pushLog]);

  const handleGetPdf = useCallback(
    async (id: string) => {
      try {
        const r = await call("GET", `/outbound-invoices/${id}/pdf`);
        if (
          r.ok &&
          r.data &&
          typeof r.data === "object" &&
          "url" in r.data &&
          typeof (r.data as { url: unknown }).url === "string"
        ) {
          window.open((r.data as { url: string }).url, "_blank", "noopener");
        }
      } catch (err) {
        pushLog(localFailure("GET", `${baseUrl}/outbound-invoices/${id}/pdf`, err));
      }
    },
    [baseUrl, call, pushLog],
  );

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero */}
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          <Plug className="h-3 w-3" /> API Playground
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Sanity-check the InvoLoops REST API
        </h1>
        <p className="mt-3 max-w-3xl text-slate-600">
          Paste a bearer key, fire requests against{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
            /api/v1
          </code>
          , and watch the raw responses below. Calls go straight from your
          browser — exactly what an external integration would see.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — actions */}
        <div className="space-y-6 lg:col-span-2">
          <ConnectionCard
            token={token}
            baseUrl={baseUrl}
            showToken={showToken}
            onToken={setToken}
            onBaseUrl={setBaseUrl}
            onToggleShowToken={() => setShowToken((s) => !s)}
            onWhoami={handleWhoami}
            whoamiBusy={meBusy}
            me={me}
            haveToken={Boolean(token)}
          />

          <CustomersCard
            form={custForm}
            onForm={setCustForm}
            customers={customers}
            selected={selectedCustomer}
            onSelect={setSelectedCustomer}
            busy={customersBusy}
            fetchedAt={customersFetchedAt}
            hasMore={customersHasMore}
            onCreate={handleCreateCustomer}
            onList={handleListCustomers}
          />

          <DocumentsCard
            docType={docType}
            onDocType={setDocType}
            currency={currency}
            onCurrency={setCurrency}
            language={language}
            onLanguage={setLanguage}
            invoiceDate={invoiceDate}
            onInvoiceDate={setInvoiceDate}
            dueDate={dueDate}
            onDueDate={setDueDate}
            vatRate={vatRate}
            onVatRate={setVatRate}
            items={items}
            onItems={setItems}
            notes={notes}
            onNotes={setNotes}
            payments={payments}
            onPayments={setPayments}
            requiresPayments={requiresPayments}
            totals={totals}
            customers={customers}
            selectedCustomer={selectedCustomer}
            onSelectedCustomer={setSelectedCustomer}
            outbound={outbound}
            lastDraft={lastDraft}
            busy={outboundBusy}
            onCreate={handleCreateDraft}
            onIssue={handleIssue}
            onList={handleListOutbound}
            onPdf={handleGetPdf}
          />
        </div>

        {/* Right column — activity log (sticky) */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-20" ref={logRef}>
            <ActivityLog log={log} onClear={() => setLog([])} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function Card({
  title,
  description,
  icon: Icon,
  right,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-indigo-600" />
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          )}
        </div>
        {right}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function ConnectionCard(props: {
  token: string;
  baseUrl: string;
  showToken: boolean;
  haveToken: boolean;
  whoamiBusy: boolean;
  me: unknown;
  onToken: (v: string) => void;
  onBaseUrl: (v: string) => void;
  onToggleShowToken: () => void;
  onWhoami: () => void;
}) {
  const meSummary = useMemo(() => {
    if (!props.me || typeof props.me !== "object") return null;
    const m = props.me as {
      user?: { email?: string; name?: string | null };
      api_key?: { name?: string; mode?: string; scopes?: string[] };
    };
    return {
      email: m.user?.email ?? "?",
      name: m.user?.name ?? null,
      keyName: m.api_key?.name ?? "?",
      mode: m.api_key?.mode ?? "?",
      scopes: m.api_key?.scopes ?? [],
    };
  }, [props.me]);

  return (
    <Card
      title="Connection"
      description="Mint a bearer key under Settings → API Keys, then paste it here."
      icon={KeyRound}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
        <Field label="Bearer key" hint="Stored in this tab's sessionStorage; cleared when you close the tab.">
          <div className="relative">
            <input
              type={props.showToken ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={props.token}
              onChange={(e) => props.onToken(e.target.value)}
              placeholder="ilk_live_… or ilk_test_…"
              className={`${inputCls} pr-9 font-mono`}
            />
            <button
              type="button"
              onClick={props.onToggleShowToken}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label={props.showToken ? "Hide key" : "Show key"}
            >
              {props.showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex items-end">
          <button
            type="button"
            onClick={props.onWhoami}
            disabled={!props.haveToken || props.whoamiBusy}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Plug className={`h-4 w-4 ${props.whoamiBusy ? "animate-pulse" : ""}`} />
            Test
          </button>
        </div>
      </div>

      <div className="mt-3">
        <Field label="Base URL" hint="Defaults to this host. Point to a sandbox URL to hit a different env.">
          <input
            type="text"
            value={props.baseUrl}
            onChange={(e) => props.onBaseUrl(e.target.value)}
            placeholder="https://example.com/api/v1"
            className={`${inputCls} font-mono`}
          />
        </Field>
      </div>

      {meSummary && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Authenticated
          </div>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">User: </dt>
              <dd className="inline">
                {meSummary.email}
                {meSummary.name ? ` (${meSummary.name})` : ""}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Key: </dt>
              <dd className="inline">
                {meSummary.keyName} · <code className="font-mono">{meSummary.mode}</code>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="inline font-semibold">Scopes: </dt>
              <dd className="inline">
                {meSummary.scopes.length === 0 ? (
                  <span className="italic text-slate-500">none</span>
                ) : (
                  meSummary.scopes.map((s) => (
                    <span
                      key={s}
                      className="mr-1 inline-block rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-emerald-200"
                    >
                      {s}
                    </span>
                  ))
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Card>
  );
}

function CustomersCard(props: {
  form: {
    name: string;
    email: string;
    phone: string;
    tax_id: string;
    address: string;
    notes: string;
  };
  onForm: (v: typeof props.form) => void;
  customers: CustomerRow[];
  selected: string;
  onSelect: (id: string) => void;
  busy: boolean;
  fetchedAt: number | null;
  hasMore: boolean;
  onCreate: () => void;
  onList: () => void;
}) {
  const set = (k: keyof typeof props.form) => (v: string) =>
    props.onForm({ ...props.form, [k]: v });

  return (
    <Card
      title="Customers"
      description="Create a customer (POST /customers) or list existing ones (GET /customers)."
      icon={Users}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *">
          <input
            className={inputCls}
            value={props.form.name}
            onChange={(e) => set("name")(e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            className={inputCls}
            type="email"
            value={props.form.email}
            onChange={(e) => set("email")(e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            value={props.form.phone}
            onChange={(e) => set("phone")(e.target.value)}
          />
        </Field>
        <Field label="Tax ID">
          <input
            className={inputCls}
            value={props.form.tax_id}
            onChange={(e) => set("tax_id")(e.target.value)}
          />
        </Field>
        <Field label="Address">
          <textarea
            className={inputCls}
            rows={2}
            value={props.form.address}
            onChange={(e) => set("address")(e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className={inputCls}
            rows={2}
            value={props.form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onCreate}
          disabled={props.busy || !props.form.name.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <UserPlus className="h-4 w-4" />
          Create customer
        </button>
        <button
          type="button"
          onClick={props.onList}
          disabled={props.busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${props.busy ? "animate-spin" : ""}`} />
          {props.fetchedAt === null ? "List customers" : "Refresh list"}
        </button>
      </div>

      {/* Result panel — always rendered once any state is meaningful, with
          dedicated empty / never-fetched states so it's obvious whether
          GET /customers returned 0 rows or never ran. */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wide text-slate-600">
            GET /customers
          </span>
          {props.fetchedAt !== null && (
            <span>
              {props.customers.length} result
              {props.customers.length === 1 ? "" : "s"}
              {props.hasMore ? " (truncated)" : ""} ·{" "}
              <time dateTime={new Date(props.fetchedAt).toISOString()}>
                fetched {formatRelative(props.fetchedAt)}
              </time>
            </span>
          )}
        </div>

        {props.fetchedAt === null && props.customers.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Press <span className="font-semibold text-slate-700">List customers</span>{" "}
            to fetch your account&apos;s customers.
          </div>
        ) : props.customers.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No customers yet. Create one with the form above.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Use</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Tax ID</th>
                <th className="px-3 py-2 text-left font-medium">ID</th>
              </tr>
            </thead>
            <tbody>
              {props.customers.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      checked={props.selected === c.id}
                      onChange={() => props.onSelect(c.id)}
                      aria-label={`Use ${c.name}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{c.name}</td>
                  <td className="px-3 py-2 text-slate-600">{c.email ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {c.tax_id ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                    {c.id.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function DocumentsCard(props: {
  docType: DocType;
  onDocType: (v: DocType) => void;
  currency: string;
  onCurrency: (v: string) => void;
  language: string;
  onLanguage: (v: string) => void;
  invoiceDate: string;
  onInvoiceDate: (v: string) => void;
  dueDate: string;
  onDueDate: (v: string) => void;
  vatRate: string;
  onVatRate: (v: string) => void;
  items: LineItem[];
  onItems: (v: LineItem[]) => void;
  notes: string;
  onNotes: (v: string) => void;
  payments: PaymentRow[];
  onPayments: (v: PaymentRow[]) => void;
  requiresPayments: boolean;
  totals: { subtotal: number; vatAmount: number; total: number };
  customers: CustomerRow[];
  selectedCustomer: string;
  onSelectedCustomer: (id: string) => void;
  outbound: OutboundRow[];
  lastDraft: OutboundRow | null;
  busy: boolean;
  onCreate: () => void;
  onIssue: (id: string) => void;
  onList: () => void;
  onPdf: (id: string) => void;
}) {
  const updateItem = (idx: number, patch: Partial<LineItem>) => {
    const next = props.items.slice();
    next[idx] = { ...next[idx], ...patch };
    props.onItems(next);
  };
  const addItem = () =>
    props.onItems([
      ...props.items,
      { description: "", quantity: "1", unitPrice: "0.00" },
    ]);
  const removeItem = (idx: number) =>
    props.onItems(props.items.filter((_, i) => i !== idx));

  const updatePayment = (idx: number, patch: Partial<PaymentRow>) => {
    const next = props.payments.slice();
    next[idx] = { ...next[idx], ...patch };
    props.onPayments(next);
  };
  const addPayment = () =>
    props.onPayments([
      ...props.payments,
      {
        method: "bank_transfer",
        amount: "0.00",
        currency: props.currency,
        date: todayIso(),
        reference: "",
      },
    ]);
  const removePayment = (idx: number) =>
    props.onPayments(props.payments.filter((_, i) => i !== idx));

  return (
    <Card
      title="Outbound documents"
      description="Create a draft (POST /outbound-invoices) and issue it (POST /…/issue)."
      icon={FileText}
      right={
        <button
          type="button"
          onClick={props.onList}
          disabled={props.busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${props.busy ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >
      {/* Document type segmented control */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {DOC_TYPES.map((t) => {
          const Icon = t.icon;
          const active = props.docType === t.value;
          return (
            <button
              type="button"
              key={t.value}
              onClick={() => props.onDocType(t.value)}
              className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Customer">
          <select
            className={inputCls}
            value={props.selectedCustomer}
            onChange={(e) => props.onSelectedCustomer(e.target.value)}
          >
            <option value="">— none (draft only) —</option>
            {props.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency">
          <input
            className={inputCls}
            value={props.currency}
            maxLength={3}
            onChange={(e) => props.onCurrency(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Language">
          <select
            className={inputCls}
            value={props.language}
            onChange={(e) => props.onLanguage(e.target.value)}
          >
            <option value="he">he</option>
            <option value="en">en</option>
          </select>
        </Field>
        <Field label="Invoice date">
          <input
            type="date"
            className={inputCls}
            value={props.invoiceDate}
            onChange={(e) => props.onInvoiceDate(e.target.value)}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            className={inputCls}
            value={props.dueDate}
            onChange={(e) => props.onDueDate(e.target.value)}
          />
        </Field>
        <Field label="VAT rate (%)">
          <input
            className={inputCls}
            value={props.vatRate}
            onChange={(e) => props.onVatRate(e.target.value)}
          />
        </Field>
      </div>

      {/* Line items */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Line items</span>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Description</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Qty</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Unit price</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Line total</th>
                <th className="w-8 px-1 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((it, idx) => {
                const lineTotal =
                  Number(it.quantity || 0) * Number(it.unitPrice || 0);
                return (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">
                      <input
                        className={inputCls}
                        value={it.description}
                        onChange={(e) =>
                          updateItem(idx, { description: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={`${inputCls} text-right`}
                        value={it.quantity}
                        onChange={(e) =>
                          updateItem(idx, { quantity: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={`${inputCls} text-right`}
                        value={it.unitPrice}
                        onChange={(e) =>
                          updateItem(idx, { unitPrice: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-700">
                      {money(Number.isFinite(lineTotal) ? lineTotal : 0)}
                    </td>
                    <td className="px-1 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        disabled={props.items.length === 1}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Remove line"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 text-xs">
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-right font-medium text-slate-600">
                  Subtotal
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-800">
                  {money(props.totals.subtotal)}
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-right font-medium text-slate-600">
                  VAT ({props.vatRate}%)
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-800">
                  {money(props.totals.vatAmount)}
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-right font-semibold text-slate-700">
                  Total
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">
                  {money(props.totals.total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="mt-3">
        <Field label="Notes">
          <textarea
            className={inputCls}
            rows={2}
            value={props.notes}
            onChange={(e) => props.onNotes(e.target.value)}
            placeholder="Optional — printed at the bottom of the PDF."
          />
        </Field>
      </div>

      {/* Payments — only for RECEIPT and TAX_INVOICE_RECEIPT */}
      {props.requiresPayments && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">
              Payments
              <span className="ml-1.5 text-xs font-normal text-slate-500">
                (sum must equal total)
              </span>
            </span>
            <button
              type="button"
              onClick={addPayment}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
          <div className="space-y-2">
            {props.payments.map((p, idx) => (
              <div
                key={idx}
                className="grid gap-2 rounded-md border border-slate-200 bg-slate-50/50 p-2 sm:grid-cols-[120px,1fr,90px,140px,30px]"
              >
                <select
                  className={inputCls}
                  value={p.method}
                  onChange={(e) =>
                    updatePayment(idx, { method: e.target.value as PaymentMethod })
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  className={inputCls}
                  placeholder="Reference"
                  value={p.reference}
                  onChange={(e) => updatePayment(idx, { reference: e.target.value })}
                />
                <input
                  className={`${inputCls} text-right`}
                  value={p.amount}
                  onChange={(e) => updatePayment(idx, { amount: e.target.value })}
                />
                <input
                  type="date"
                  className={inputCls}
                  value={p.date}
                  onChange={(e) => updatePayment(idx, { date: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removePayment(idx)}
                  disabled={props.payments.length === 1}
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Remove payment"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={props.onCreate}
          disabled={props.busy || props.items.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <FileText className="h-4 w-4" />
          Create draft
        </button>
        {props.lastDraft && props.lastDraft.status === "draft" && (
          <button
            type="button"
            onClick={() => props.onIssue(props.lastDraft!.id)}
            disabled={props.busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Send className="h-4 w-4" />
            Issue {props.lastDraft.formatted_number ?? props.lastDraft.id.slice(0, 8)}
          </button>
        )}
        {props.lastDraft && (
          <span className="text-xs text-slate-500">
            Last draft:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
              {props.lastDraft.formatted_number ?? props.lastDraft.id}
            </code>{" "}
            · status{" "}
            <span
              className={`rounded px-1 py-0.5 text-[11px] font-medium ${
                props.lastDraft.status === "issued"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {props.lastDraft.status}
            </span>
          </span>
        )}
      </div>

      {/* Recent documents */}
      {props.outbound.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Number</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {props.outbound.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">
                    {row.formatted_number ?? row.id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.document_type}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        row.status === "issued" || row.status === "paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : row.status === "draft"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {row.total ?? "—"} {row.currency ?? ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.status === "draft" ? (
                      <button
                        type="button"
                        onClick={() => props.onIssue(row.id)}
                        disabled={props.busy}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Send className="h-3 w-3" /> Issue
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => props.onPdf(row.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <ExternalLink className="h-3 w-3" /> PDF
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ActivityLog({
  log,
  onClear,
}: {
  log: LogEntry[];
  onClear: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-3 text-white">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30" />
          Activity log
        </h2>
        <button
          type="button"
          onClick={onClear}
          disabled={log.length === 0}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </header>
      <div className="max-h-[80vh] overflow-y-auto bg-slate-950 p-2 font-mono text-xs">
        {log.length === 0 ? (
          <p className="px-2 py-6 text-center text-slate-500">
            No requests yet. Fire off a “Test” or “Create” to see traffic here.
          </p>
        ) : (
          log.map((e) => <LogRow key={e.id} entry={e} />)
        )}
      </div>
    </section>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const statusColor = entry.ok
    ? "text-emerald-400"
    : entry.status >= 400
    ? "text-rose-400"
    : "text-amber-400";
  return (
    <div className="mb-1 overflow-hidden rounded-md border border-slate-800/60 bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-800/60"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 text-slate-500" />
        )}
        <span
          className={`inline-flex w-12 shrink-0 justify-center rounded px-1 py-0.5 text-[10px] font-bold ${
            entry.method === "GET"
              ? "bg-emerald-500/15 text-emerald-300"
              : entry.method === "DELETE"
              ? "bg-rose-500/15 text-rose-300"
              : "bg-sky-500/15 text-sky-300"
          }`}
        >
          {entry.method}
        </span>
        <span className={`w-10 shrink-0 text-right ${statusColor}`}>
          {entry.status || (entry.ok ? "—" : "ERR")}
        </span>
        <span className="flex-1 truncate text-slate-300">
          {stripBase(entry.url)}
        </span>
        <span className="shrink-0 text-slate-500">{entry.ms}ms</span>
        {!entry.ok && <AlertCircle className="h-3 w-3 shrink-0 text-rose-400" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-800/60 bg-slate-950/80 px-2 py-2 text-[11px]">
          <details>
            <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
              Request
            </summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-slate-200">
              {pretty(entry.request)}
            </pre>
          </details>
          <details open>
            <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
              Response
            </summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-slate-200">
              {pretty(entry.response)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function localFailure(method: string, url: string, err: unknown): LogEntry {
  return {
    id: newId(),
    method,
    url,
    status: 0,
    ms: 0,
    ok: false,
    request: { headers: {}, body: null },
    response: {
      headers: {},
      body: { error: err instanceof Error ? err.message : String(err) },
    },
    ts: Date.now(),
  };
}

function pretty(v: unknown): string {
  // Redact the bearer token from request headers before display so the
  // copy-paste-friendly log doesn't leak the secret if the user shares
  // a screenshot.
  const cloned: unknown = JSON.parse(JSON.stringify(v));
  if (
    cloned &&
    typeof cloned === "object" &&
    "headers" in cloned &&
    typeof (cloned as { headers: unknown }).headers === "object"
  ) {
    const headers = (cloned as { headers: Record<string, string> }).headers;
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === "authorization" && headers[k]) {
        headers[k] = headers[k].replace(/(Bearer\s+)(\S+)/, (_, p, t) =>
          `${p}${String(t).slice(0, 8)}…${String(t).slice(-4)}`,
        );
      }
    }
  }
  return JSON.stringify(cloned, null, 2);
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

function stripBase(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function isPage(v: unknown): v is { data: unknown[] } {
  return (
    !!v &&
    typeof v === "object" &&
    "data" in v &&
    Array.isArray((v as { data: unknown }).data)
  );
}

function isCustomer(v: unknown): v is CustomerRow {
  return (
    !!v &&
    typeof v === "object" &&
    "id" in v &&
    typeof (v as { id: unknown }).id === "string"
  );
}

function isOutbound(v: unknown): v is OutboundRow {
  return (
    !!v &&
    typeof v === "object" &&
    "id" in v &&
    typeof (v as { id: unknown }).id === "string" &&
    "document_type" in v
  );
}
