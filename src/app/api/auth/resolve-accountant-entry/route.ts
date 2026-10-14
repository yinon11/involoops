import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPublicAppOrigin } from "@/lib/public-app-origin";

export const runtime = "nodejs";

/**
 * Entry resolver for the accountant login page (`/login/accountant`).
 *
 * Same credentials as `/login`, but the default landing is Studio
 * (`/creator`). The mode cookie is set by `middleware.ts` once that
 * path is hit. Delegates to `resolve-entry-session` so act-as /
 * switch-back still run in one place.
 */
function safeNext(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("next");
  if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return null;
}

export async function GET(request: Request) {
  const origin = getPublicAppOrigin(request);
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const explicitNext = safeNext(request);
  const next = explicitNext ?? "/money-in";

  const target = new URL("/api/auth/resolve-entry-session", origin);
  target.searchParams.set("next", next);
  return NextResponse.redirect(target);
}
