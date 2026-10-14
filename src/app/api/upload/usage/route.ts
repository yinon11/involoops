import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkUsageLimit } from "@/lib/usage";

/**
 * Cheap read-only endpoint the client can hit before starting a
 * batch upload (e.g. a ZIP full of invoices) to find out up-front
 * whether the user still has quota. Lets the upload UI refuse the
 * whole batch with a single row instead of letting the first file
 * go to /api/upload/file, collect a 403, and render an error on
 * every subsequent file.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const usage = await checkUsageLimit(session.user.id);
  return NextResponse.json({
    allowed: usage.allowed,
    current: usage.current,
    limit: usage.limit,
    planName: usage.planName,
  });
}
