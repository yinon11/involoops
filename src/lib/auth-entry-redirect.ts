import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isStudioPinnedEmail } from "@/lib/auth/studio-pinned-accounts";

/**
 * For /login and /register: if a session already exists, send the user to the
 * dashboard. If they were acting as a linked (managed) account, switch back to
 * their manager account first so visiting auth entry routes always lands on the
 * manager’s own session—not the managed account.
 */
export async function redirectIfSessionExistsFromAuthEntryPage() {
  const session = await auth();
  if (!session?.user) {
    return;
  }
  const originatorId = session.user.originator?.id;
  if (originatorId) {
    redirect("/api/auth/resolve-entry-session");
  }
  // Studio-pinned accounts always land in the creator shell — defer to the
  // entry resolver (which handles any act-as switch and overrides the
  // destination to /creator) instead of the expense dashboard.
  const userId = session.user.id;
  if (userId) {
    const me = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true },
    });
    if (isStudioPinnedEmail(me?.email)) {
      redirect("/api/auth/resolve-entry-session");
    }
  }
  redirect("/");
}
