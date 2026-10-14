import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import { db } from "@/db";
import { archiveObjects, ARCHIVE_OBJECT_KINDS } from "@/db/schema";
import { getArchiveObjectBytes } from "@/lib/archive/s3";

export const runtime = "nodejs";

const KINDS = new Set<string>(ARCHIVE_OBJECT_KINDS);

/**
 * GET /api/files/archive?documentId=...&objectKind=...
 *
 * Same-origin proxy for the 7-year COMPLIANCE-locked archive bucket
 * (Spec 05). Admin-only. Streams the bytes through the app instead of
 * handing the browser a presigned URL — the bucket can stay private,
 * and we sidestep the cross-host TLS / CORS / SigV4 issues that come
 * with serving the archive host straight to the browser.
 *
 * The `EXPORTED` audit entry is still written by the server-action
 * caller (`getArchiveDownloadUrl`) so verification chains aren't
 * affected by the route change.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isUserAdmin(session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const documentId = req.nextUrl.searchParams.get("documentId")?.trim();
  const objectKind = req.nextUrl.searchParams.get("objectKind")?.trim();

  if (!documentId || !objectKind || !KINDS.has(objectKind)) {
    return NextResponse.json(
      { error: "documentId and a valid objectKind are required" },
      { status: 400 },
    );
  }

  const [row] = await db
    .select({
      s3Key: archiveObjects.s3Key,
      s3VersionId: archiveObjects.s3VersionId,
      contentType: archiveObjects.contentType,
    })
    .from(archiveObjects)
    .where(
      and(
        eq(archiveObjects.documentId, documentId),
        eq(
          archiveObjects.objectKind,
          objectKind as (typeof ARCHIVE_OBJECT_KINDS)[number],
        ),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await getArchiveObjectBytes({
      key: row.s3Key,
      versionId: row.s3VersionId,
    });

    // Pull a sensible filename out of the S3 key so the browser's
    // download dialog shows something meaningful instead of the UUID
    // path. `attachment` forces a download rather than inline render —
    // archive payloads (canonical JSON, signed PDF) are not for live
    // viewing in this admin context.
    const filename = row.s3Key.split("/").pop() || "archive";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": row.contentType,
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[files.archive] download failed", err);
    return NextResponse.json(
      { error: "Failed to load archive object" },
      { status: 502 },
    );
  }
}
