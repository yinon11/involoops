import type { NextRequest } from "next/server";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { webhookTestDeliverySchema } from "@/lib/api/schemas";
import { executeDelivery } from "@/lib/webhooks/deliver";
import { newRequestId } from "@/lib/api/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhook-endpoints/{id}/test
 *
 * Fires a synthetic delivery at the endpoint IMMEDIATELY (inline; no
 * cron wait) so integrators can verify their receiver end-to-end.
 *
 * Test deliveries:
 *   - Carry `X-Involoops-Test: true` in addition to the normal headers.
 *   - Do NOT count toward the endpoint's consecutive_failures counter,
 *     so a failed test never auto-disables a production endpoint.
 *   - Are dead-lettered on any non-2xx (no retry schedule).
 *
 * Response shape reports the receiver's response so the integrator
 * sees status, body snippet, and any error inline — no need to hit
 * `/webhook-endpoints/{id}` afterward.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runApiRoute(
    req,
    {
      scopes: ["webhooks:write"],
      body: webhookTestDeliverySchema,
      idempotency: "supported",
    },
    async ({ ctx, body }) => {
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
      const endpoint = rows[0];
      if (!endpoint) throw apiErrors.notFound("Webhook endpoint");

      if (!endpoint.active || endpoint.disabledAt) {
        throw new ApiError({
          code: "conflict",
          status: 409,
          title: "Endpoint is not active",
          detail:
            "Re-enable the endpoint first via PATCH {active: true}. Disabled reason: " +
            (endpoint.disabledReason ?? "(none)"),
        });
      }

      const eventType = body.event_type ?? "event.test";
      const eventId = `evt_test_${newRequestId()}`;
      const createdAt = new Date().toISOString();

      const payload = {
        id: eventId,
        type: eventType,
        version: 1,
        created_at: createdAt,
        api_version: "v1",
        livemode: false,
        test: true,
        data: {
          message:
            "This is a test delivery from InvoLoops. Verify the X-Involoops-Signature " +
            "header against this body and reply 2xx to confirm your receiver works.",
        },
      };

      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          endpointId: endpoint.id,
          userId: ctx.user.id,
          eventId,
          eventType,
          payload,
          status: "pending",
        })
        .returning();

      const result = await executeDelivery({
        delivery: {
          id: delivery.id,
          endpointId: delivery.endpointId,
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          payload: delivery.payload,
          attempts: delivery.attempts,
        },
        isTest: true,
      });

      return {
        status: 200,
        body: {
          object: "webhook_test_result",
          delivery_id: result.deliveryId,
          ok: result.ok,
          outcome: result.outcome,
          attempts: result.attempts,
          response_status: result.responseStatus,
          response_snippet: result.responseSnippet,
          error: result.error,
          event: {
            id: eventId,
            type: eventType,
            created_at: createdAt,
          },
        },
      };
    },
  );
}
