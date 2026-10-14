import type { NextRequest } from "next/server";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { serializeWebhookEndpoint } from "@/lib/api/serializers/webhook-endpoint";
import { webhookEndpointPatchSchema } from "@/lib/api/schemas";
import { isEventType, EVENT_TYPES, type EventType } from "@/lib/webhooks/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(req, { scopes: ["webhooks:write"] }, async ({ ctx }) => {
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.userId, ctx.user.id),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw apiErrors.notFound("Webhook endpoint");
    return { status: 200, body: serializeWebhookEndpoint(row) };
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["webhooks:write"],
      body: webhookEndpointPatchSchema,
      idempotency: "supported",
    },
    async ({ ctx, body }) => {
      const patch: Record<string, unknown> = {};
      if (body.description !== undefined) patch.description = body.description;
      if (body.active !== undefined) {
        patch.active = body.active;
        if (body.active === true) {
          // Re-enabling clears auto-disable state so the worker can retry.
          patch.disabledAt = null;
          patch.disabledReason = null;
          patch.consecutiveFailures = 0;
        }
      }
      if (body.events !== undefined) {
        const events: EventType[] = [];
        const unknown: string[] = [];
        for (const e of body.events) {
          if (isEventType(e)) {
            if (!events.includes(e)) events.push(e);
          } else {
            unknown.push(e);
          }
        }
        if (unknown.length > 0) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Unknown event types",
            detail: `Unknown: ${unknown.join(", ")}. Valid: ${EVENT_TYPES.join(", ")}.`,
          });
        }
        patch.events = events;
      }

      const [row] = await db
        .update(webhookEndpoints)
        .set(patch)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.userId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) throw apiErrors.notFound("Webhook endpoint");
      return { status: 200, body: serializeWebhookEndpoint(row) };
    },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    { scopes: ["webhooks:write"], idempotency: "supported" },
    async ({ ctx }) => {
      const rows = await db
        .delete(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.userId, ctx.user.id),
          ),
        )
        .returning({ id: webhookEndpoints.id });
      if (rows.length === 0) throw apiErrors.notFound("Webhook endpoint");
      return { status: 204, body: null };
    },
  );
}
