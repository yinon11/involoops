import "server-only";

/**
 * Generate a studio (outbound generator) TAX_INVOICE_RECEIPT for an incoming
 * Stripe subscription payment, acting as the operator's own billing account.
 *
 * We deliberately go through the PUBLIC REST API (`/api/v1/*`) authenticated
 * with `STUDIO_API_KEY` rather than calling the generator's internal
 * operations directly. This keeps the Stripe webhook (a billing/shared concern)
 * decoupled from the generator domain — it never imports `src/features/generator`
 * or `src/lib/outbound`, so the ESLint domain boundary stays intact — and it
 * exercises the exact same code path (scopes, idempotency, gapless numbering,
 * SHAAM submission) an external integrator would use.
 *
 * Behaviour is gated by `STUDIO_RECEIPT_MODE`:
 *   - "off"   → disabled (no-op)
 *   - "draft" → create the receipt as a draft only (manual review + issue)
 *   - "issue" → create AND issue (allocates the fiscal number, signs, submits
 *               to SHAAM — irreversible)
 *
 * Idempotency: the create/issue calls carry a stable `Idempotency-Key` derived
 * from the Stripe invoice id, so duplicate webhook deliveries (or `invoice.paid`
 * firing alongside `invoice.payment_succeeded`) never produce a second document.
 */

export type StudioReceiptMode = "off" | "draft" | "issue";

const VAT_RATE = 18;

export function getStudioReceiptMode(): StudioReceiptMode {
  const raw = (process.env.STUDIO_RECEIPT_MODE ?? "off").trim().toLowerCase();
  if (raw === "draft") return "draft";
  if (raw === "issue") return "issue";
  return "off";
}

export interface StudioReceiptInput {
  /** Public app origin used for the self-call (e.g. https://involoops.com). */
  origin: string;
  /** Customer (the paying InvoLoops subscriber) as it should appear in the studio. */
  customer: { name: string; email: string | null; taxId: string | null };
  /** Human-readable plan name for the line description, e.g. "Professional". */
  planName: string;
  /** Gross amount actually collected (Stripe amount_paid / 100). */
  grossAmount: number;
  /** ISO-4217 currency, any case (normalised to upper here). */
  currency: string;
  /** Date the payment was received, YYYY-MM-DD. */
  paidDate: string;
  /** Stripe invoice id — drives idempotency keys, payment reference and notes. */
  stripeInvoiceId: string;
  /** Behaviour mode (already resolved by the caller). */
  mode: StudioReceiptMode;
}

export interface StudioReceiptResult {
  customerId: string;
  invoiceId: string;
  issued: boolean;
}

/** Split a VAT-inclusive gross into net subtotal + VAT (mirrors the seed script). */
function vatInclusiveSplit(gross: number): {
  subtotal: number;
  vatAmount: number;
  total: number;
} {
  const subtotal = Math.round((gross / (1 + VAT_RATE / 100)) * 100) / 100;
  const vatAmount = Math.round((gross - subtotal) * 100) / 100;
  return { subtotal, vatAmount, total: gross };
}

function money(n: number): string {
  return n.toFixed(2);
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

interface CustomerJson {
  id: string;
  name: string | null;
  email: string | null;
}

interface CustomerListJson {
  data?: CustomerJson[];
}

/**
 * Create the studio receipt. Throws on any failure — the caller (Stripe webhook)
 * must wrap this in its own try/catch so a studio-side error never fails the
 * webhook response back to Stripe.
 */
export async function createStudioReceiptForStripeInvoice(
  input: StudioReceiptInput,
): Promise<StudioReceiptResult> {
  const apiKey = process.env.STUDIO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("STUDIO_API_KEY is not set");
  }

  const base = input.origin.replace(/\/$/, "");
  const currency = input.currency.toUpperCase();

  const customerId = await findOrCreateCustomer(base, apiKey, input.customer);

  const { subtotal, vatAmount, total } = vatInclusiveSplit(input.grossAmount);

  const createBody = {
    document_type: "TAX_INVOICE_RECEIPT",
    customer_id: customerId,
    invoice_date: input.paidDate,
    items: [
      {
        description: `InvoLoops ${input.planName} — מנוי חודשי (${money(
          input.grossAmount,
        )} ${currency})`,
        quantity: 1,
        // Line amounts are net (excl. VAT) so the create op's total
        // re-derivation (subtotal = Σ line totals, total = subtotal + VAT) passes.
        unitPrice: subtotal,
        total: subtotal,
      },
    ],
    subtotal: money(subtotal),
    vat_rate: String(VAT_RATE),
    vat_amount: money(vatAmount),
    total: money(total),
    currency,
    language: "he",
    notes: `Stripe: ${input.stripeInvoiceId}`,
    payments: [
      {
        method: "card" as const,
        amount: total,
        currency,
        date: input.paidDate,
        reference: input.stripeInvoiceId,
      },
    ],
  };

  const createRes = await apiFetch(
    base,
    apiKey,
    "/api/v1/outbound-invoices",
    "POST",
    createBody,
    `stripe-receipt-${input.stripeInvoiceId}`,
  );
  if (createRes.status !== 201) {
    throw new Error(
      `create receipt failed: ${createRes.status} ${await safeBody(createRes)}`,
    );
  }
  const created = (await createRes.json()) as { id: string };
  const invoiceId = created.id;

  let issued = false;
  if (input.mode === "issue") {
    const issueRes = await apiFetch(
      base,
      apiKey,
      `/api/v1/outbound-invoices/${invoiceId}/issue`,
      "POST",
      {},
      `stripe-receipt-issue-${input.stripeInvoiceId}`,
    );
    if (!issueRes.ok) {
      throw new Error(
        `issue receipt ${invoiceId} failed: ${issueRes.status} ${await safeBody(
          issueRes,
        )}`,
      );
    }
    issued = true;
  }

  return { customerId, invoiceId, issued };
}

async function findOrCreateCustomer(
  base: string,
  apiKey: string,
  customer: { name: string; email: string | null; taxId: string | null },
): Promise<string> {
  const existing = await findCustomer(base, apiKey, customer);
  if (existing) return existing;

  const createRes = await apiFetch(
    base,
    apiKey,
    "/api/v1/customers",
    "POST",
    {
      name: customer.name,
      email: customer.email,
      tax_id: customer.taxId,
    },
    `studio-customer-${customer.email ?? customer.name}`,
  );

  if (createRes.status === 201) {
    const created = (await createRes.json()) as CustomerJson;
    return created.id;
  }

  // Unique (user_id, name) conflict — someone/we already created it. Re-find.
  if (createRes.status === 409) {
    const afterConflict = await findCustomer(base, apiKey, customer);
    if (afterConflict) return afterConflict;
  }

  throw new Error(
    `customer create failed: ${createRes.status} ${await safeBody(createRes)}`,
  );
}

/**
 * The list endpoint only supports a name substring filter (`q`), so we list by
 * name then match on email (preferred) or exact name client-side.
 */
async function findCustomer(
  base: string,
  apiKey: string,
  customer: { name: string; email: string | null },
): Promise<string | null> {
  const q = encodeURIComponent(customer.name);
  const res = await fetch(`${base}/api/v1/customers?q=${q}&limit=200`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as CustomerListJson;
  const rows = json.data ?? [];
  const email = customer.email?.toLowerCase() ?? null;
  const match =
    (email
      ? rows.find((r) => r.email && r.email.toLowerCase() === email)
      : undefined) ?? rows.find((r) => r.name === customer.name);
  return match?.id ?? null;
}

async function apiFetch(
  base: string,
  apiKey: string,
  path: string,
  method: "POST",
  body: unknown,
  idempotencyKey: string,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}
