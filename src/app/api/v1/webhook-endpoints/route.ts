import type { NextRequest } from "next/server";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { buildPage, parsePaginationParams } from "@/lib/api/pagination";
import { serializeWebhookEndpoint } from "@/lib/api/serializers/webhook-endpoint";
import { webhookEndpointCreateSchema } from "@/lib/api/schemas";
import {
  generateWebhookSecret,
  isWebhookSecretStorageConfigured,
} from "@/lib/webhooks/signing";
import { parseWebhookUrl, WebhookUrlRejectedError } from "@/lib/webhooks/ssrf";
import { isEventType, EVENT_TYPES, type EventType } from "@/lib/webhooks/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/webhook-endpoints — cursor-paginated list (created_at DESC, id DESC). */
export async function GET(req: NextRequest) {
  return runApiRoute(req, { scopes: ["webhooks:write"] }, async ({ ctx, url }) => {
    const { limit, cursor } = parsePaginationParams(url);
    const filters = [eq(webhookEndpoints.userId, ctx.user.id)];
    if (cursor) {
      const cursorDate = new Date(cursor.k);
      if (!isNaN(cursorDate.getTime())) {
        filters.push(
          or(
            lt(webhookEndpoints.createdAt, cursorDate),
            and(
              eq(webhookEndpoints.createdAt, cursorDate),
              lt(webhookEndpoints.id, cursor.id),
            ),
          )!,
        );
      }
    }
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(and(...filters))
      .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id))
      .limit(limit + 1);

    return {
      status: 200,
      body: buildPage(
        rows.map(serializeWebhookEndpoint),
        limit,
        (r) => r.created_at,
      ),
    };
  });
}

/**
 * POST /api/v1/webhook-endpoints — register a new endpoint.
 * Returns the plaintext signing secret ONCE. Clients must store it
 * immediately; the server can still sign outgoing deliveries because
 * the secret is persisted as AES-GCM ciphertext, but the plaintext is
 * never exposed again after this response.
 */
export async function POST(req: NextRequest) {
  return runApiRoute(
    req,
    {
      scopes: ["webhooks:write"],
      body: webhookEndpointCreateSchema,
      idempotency: "required",
    },
    async ({ ctx, body }) => {
      if (!isWebhookSecretStorageConfigured()) {
        throw new ApiError({
          code: "internal_error",
          status: 500,
          title: "Webhook storage not configured",
          detail:
            "Server is missing WEBHOOK_SECRET_ENCRYPTION_SECRET (or AUTH_SECRET fallback).",
        });
      }

      try {
        parseWebhookUrl(body.url);
      } catch (err) {
        if (err instanceof WebhookUrlRejectedError) {
          throw new ApiError({
            code: "validation_failed",
            status: 422,
            title: "Invalid webhook URL",
            detail: err.message,
          });
        }
        throw err;
      }

      const events: EventType[] = [];
      const unknownEvents: string[] = [];
      for (const e of body.events) {
        if (isEventType(e)) {
          if (!events.includes(e)) events.push(e);
        } else {
          unknownEvents.push(e);
        }
      }
      if (unknownEvents.length > 0) {
        throw new ApiError({
          code: "validation_failed",
          status: 422,
          title: "Unknown event types",
          detail: `Unknown: ${unknownEvents.join(", ")}. Valid: ${EVENT_TYPES.join(", ")}.`,
        });
      }

      const { token, hint, encrypted } = generateWebhookSecret();
      const [row] = await db
        .insert(webhookEndpoints)
        .values({
          userId: ctx.user.id,
          url: body.url,
          description: body.description ?? null,
          events,
          secretCiphertext: encrypted.ciphertext,
          secretIv: encrypted.iv,
          secretTag: encrypted.tag,
          secretHint: hint,
        })
        .returning();

      return {
        status: 201,
        body: {
          ...serializeWebhookEndpoint(row),
          // Plaintext signing secret — shown exactly once.
          secret: token,
        },
      };
    },
  );
}
