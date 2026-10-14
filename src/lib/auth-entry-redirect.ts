import { redirect } from "next/navigation";
import { auth } from "@/auth";

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
  redirect("/");
}
