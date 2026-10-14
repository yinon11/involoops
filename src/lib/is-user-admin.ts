import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/** Source of truth for admin — JWT can lag behind DB after role changes. */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isAdmin: true },
  });
  return row?.isAdmin === true;
}
