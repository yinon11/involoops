import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  getBusinessStatusOp,
  getExpenseDashboardOp,
  getIncomeDashboardOp,
  getProfitSummaryOp,
  getSpendInsightsOp,
  listInboundInvoicesOp,
  type AnalyticsPeriodFilters,
} from "@/lib/expenses/analytics";
import { readOnlyAnnotations, withTitle } from "./annotations";
import { requireMcpAuth } from "./auth";
import { runTool } from "./respond";

const periodSchema = z.object({
  time_range: z
    .enum(["allTime", "last12Months", "year"])
    .optional()
    .describe(
      "Quick period filter. Default last12Months for business/profit tools; allTime for expense-only if omitted there.",
    ),
  year: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe("Calendar year filter (use with time_range=year or alone)"),
  months: z
    .array(z.number().int().min(1).max(12))
    .max(12)
    .optional()
    .describe("Optional month numbers 1-12 within `year`"),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive start date YYYY-MM-DD"),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive end date YYYY-MM-DD"),
  show_without_vat: z
    .boolean()
    .optional()
    .describe("When true, sum amounts excluding VAT"),
  vendor_ids: z
    .array(z.string().uuid())
    .max(50)
    .optional()
    .describe("Optional vendor filter (expense/income dashboards only)"),
});

function toPeriod(
  args: z.infer<typeof periodSchema>,
  defaultRange: AnalyticsPeriodFilters["timeRange"] = "last12Months",
): AnalyticsPeriodFilters {
  return {
    timeRange: args.time_range ?? defaultRange,
    year: args.year,
    months: args.months,
    dateFrom: args.date_from,
    dateTo: args.date_to,
    showWithoutVat: args.show_without_vat,
    vendorIds: args.vendor_ids,
  };
}

/**
 * Expense / business-status tools for agents.
 * Require `invoices:read` (same catalog as the planned inbound REST API).
 */
export function registerExpenseAnalyticsTools(server: McpServer): void {
  server.registerTool(
    "get_business_status",
    withTitle({
      title: "Get Business Status",
      description:
        "One-shot business snapshot for agents: income vs expense, net profit/margin, 30-day burn, inbox backlog, top vendors/clients, monthly P&L, and spend insights (spikes, concentration, overspend pace). Prefer this first when asked how the business is doing.",
      inputSchema: periodSchema,
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["invoices:read"]);
        return getBusinessStatusOp(userId, toPeriod(args, "last12Months"));
      }),
  );

  server.registerTool(
    "get_expense_summary",
    withTitle({
      title: "Get Expense Summary",
      description:
        "Approved expense KPIs for a period: total spent, monthly average, 30-day burn, vendor count, trend buckets, and full spend-by-vendor breakdown with share_pct.",
      inputSchema: periodSchema,
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["invoices:read"]);
        return getExpenseDashboardOp(userId, toPeriod(args, "last12Months"));
      }),
  );

  server.registerTool(
    "get_spend_by_vendor",
    withTitle({
      title: "Get Spend by Vendor",
      description:
        "How expenses are split between vendors for a period (sorted by total, with share_pct). Use for 'where does money go' questions.",
      inputSchema: periodSchema.extend({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max vendors to return (default 25)"),
      }),
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["invoices:read"]);
        const dash = await getExpenseDashboardOp(
          userId,
          toPeriod(args, "last12Months"),
        );
        const limit = args.limit ?? 25;
        return {
          object: "spend_by_vendor",
          currency: dash.currency,
          period: dash.period,
          total_spent: dash.total_spent,
          vendors: dash.spend_by_vendor.slice(0, limit),
        };
      }),
  );

  server.registerTool(
    "get_income_summary",
    withTitle({
      title: "Get Income Summary",
      description:
        "Approved income KPIs: total earned, monthly average, 30-day run rate, client breakdown with share_pct.",
      inputSchema: periodSchema,
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["invoices:read"]);
        return getIncomeDashboardOp(userId, toPeriod(args, "last12Months"));
      }),
  );

  server.registerTool(
    "get_profit_summary",
    withTitle({
      title: "Get Profit Summary",
      description:
        "Profit & loss for a period: income, expense, net profit, margin, best/worst months, monthly breakdown.",
      inputSchema: periodSchema.omit({ vendor_ids: true }),
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["invoices:read"]);
        return getProfitSummaryOp(userId, toPeriod(args, "last12Months"));
      }),
  );

  server.registerTool(
    "get_spend_insights",
    withTitle({
      title: "Get Spend Insights",
      description:
        "Heuristic signals for overspending / savings opportunities: vendor spikes vs prior window, spend drops, vendor concentration, burn vs monthly average, pending backlog, loss-making periods. Not a budget system — use as leads for the agent to investigate with get_spend_by_vendor / list_inbound_invoices.",
      inputSchema: z.object({
        window_days: z
          .number()
          .int()
          .min(14)
          .max(365)
          .optional()
          .describe("Current window length in days (default 90)"),
        spike_pct: z
          .number()
          .min(0.05)
          .max(2)
          .optional()
          .describe("Relative change threshold (default 0.25 = 25%)"),
        spike_min_amount: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Minimum absolute change in display currency to flag (default 200)",
          ),
        concentration_pct: z
          .number()
          .min(0.1)
          .max(0.9)
          .optional()
          .describe(
            "Vendor share of period spend that counts as concentration (default 0.25)",
          ),
      }),
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["invoices:read"]);
        return getSpendInsightsOp(userId, {
          windowDays: args.window_days,
          spikePct: args.spike_pct,
          spikeMinAmount: args.spike_min_amount,
          concentrationPct: args.concentration_pct,
        });
      }),
  );

  server.registerTool(
    "list_inbound_invoices",
    withTitle({
      title: "List Inbound Invoices",
      description:
        "List expense/income (inbound) invoices for drill-down by status, type, vendor, date, or accountant handoff. Use after insights to inspect specific spend.",
      inputSchema: z.object({
        status: z
          .enum(["processing", "pending", "approved", "rejected"])
          .optional(),
        type: z.enum(["expense", "income"]).optional(),
        vendor_id: z.string().uuid().optional(),
        date_from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        date_to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        search: z
          .string()
          .max(100)
          .optional()
          .describe("Invoice number substring"),
        unlinked_vendor_only: z
          .boolean()
          .optional()
          .describe("Only invoices with no linked vendor"),
        sent_to_accountant: z
          .boolean()
          .optional()
          .describe(
            "Filter by accountant handoff: true = sent only, false = not sent only",
          ),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    }),
    async (args, ctx) =>
      runTool(async () => {
        const { userId } = requireMcpAuth(ctx, ["invoices:read"]);
        return listInboundInvoicesOp(userId, {
          status: args.status,
          type: args.type,
          vendorId: args.vendor_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          search: args.search,
          unlinkedVendorOnly: args.unlinked_vendor_only,
          sentToAccountant: args.sent_to_accountant,
          limit: args.limit,
        });
      }),
  );
}
