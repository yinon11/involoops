import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { businessEntities } from "@/db/schema";

export type BusinessEntityRow = typeof businessEntities.$inferSelect;

/**
 * Resolve the business entity owned by `userId`, or `null` if the user
 * has not yet set up their business details.
 *
 * Memoised per request via React's `cache()` so server components and
 * downstream actions pay one DB round trip even when multiple helpers
 * ask for the same entity.
 *
 * Use this in **read-only** call sites (page loaders, dashboards) that
 * should render gracefully when the user has no entity. Mutation paths
 * should call `getBusinessEntityForUser` instead, which throws.
 */
export const getBusinessEntityForUserOrNull = cache(
  async (userId: string): Promise<BusinessEntityRow | null> => {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(eq(businessEntities.ownerUserId, userId))
      .limit(1);
    return row ?? null;
  },
);

/**
 * Strict variant — throws if the user has no business entity row.
 *
 * Mutation server actions (create invoice, allocate document number,
 * customer mutations, etc.) call this so that an authenticated user
 * who somehow reaches a mutation without finishing onboarding gets a
 * loud error instead of corrupting data with a `null` foreign key.
 */
export const getBusinessEntityForUser = cache(
  async (userId: string): Promise<BusinessEntityRow> => {
    const row = await getBusinessEntityForUserOrNull(userId);
    if (!row) {
      throw new Error(
        `No business entity for user ${userId}. The user must save their ` +
          `business details from /creator/business-details before invoking ` +
          `entity-scoped operations.`,
      );
    }
    return row;
  },
);
