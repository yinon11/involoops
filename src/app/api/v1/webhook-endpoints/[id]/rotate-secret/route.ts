import type { NextRequest } from "next/server";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runApiRoute } from "@/lib/api/handler";
import { apiErrors } from "@/lib/api/errors";
import { serializeWebhookEndpoint } from "@/lib/api/serializers/webhook-endpoint";
import { webhookRotateSecretSchema } from "@/lib/api/schemas";
import { generateWebhookSecret } from "@/lib/webhooks/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhook-endpoints/{id}/rotate-secret
 *
 * Generates a fresh signing secret and returns it ONCE. Existing deliveries
 * that are mid-retry will use the new secret on the next attempt — receivers
 * should accept either the old or new signature for a grace period on their
 * side, then switch. Store the returned plaintext in a secret manager.
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
      body: webhookRotateSecretSchema,
      idempotency: "required",
    },
    async ({ ctx }) => {
      const { token, hint, encrypted } = generateWebhookSecret();
      const [row] = await db
        .update(webhookEndpoints)
        .set({
          secretCiphertext: encrypted.ciphertext,
          secretIv: encrypted.iv,
          secretTag: encrypted.tag,
          secretHint: hint,
        })
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.userId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) throw apiErrors.notFound("Webhook endpoint");
      return {
        status: 200,
        body: { ...serializeWebhookEndpoint(row), secret: token },
      };
    },
  );
}
