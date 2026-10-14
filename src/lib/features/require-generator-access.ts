import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";

/**
 * Same as next-auth's Session but with `user.id` narrowed to a string.
 * Page handlers no longer need the `session.user.id!` workaround.
 */
export type GeneratorSession = Session & {
  user: NonNullable<Session["user"]> & { id: string };
};

/**
 * Page-level guard for Studio (invoice generator) surfaces.
 *
 * Studio UI is available to every signed-in user. Issuing documents is
 * still blocked in the form until a business entity exists, and
 * mutations keep their RBAC / capability checks.
 *
 *   - No session -> /login
 */
export async function requireGeneratorAccess(): Promise<GeneratorSession> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session as GeneratorSession;
}
