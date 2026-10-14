import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resolveDisplayCurrency } from "@/lib/fx";

/**
 * Dashboard display currency for a user.
 *
 * Reads Settings → Dashboard Currency (`users.display_currency`). An empty
 * preference falls back to `DEFAULT_DISPLAY_CURRENCY`, then ILS.
 */
export async function getUserDisplayCurrency(userId: string): Promise<string> {
  const [row] = await db
    .select({ displayCurrency: users.displayCurrency })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return resolveDisplayCurrency(row?.displayCurrency ?? null);
}
