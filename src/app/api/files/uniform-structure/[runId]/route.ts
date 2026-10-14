import { NextRequest, NextResponse } from "next/server";
import { downloadFile } from "@/lib/storage";
import { loadExportForDownload } from "@/lib/uniform-structure/export-file-auth";

export const runtime = "nodejs";

const RUN_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;

/**
 * GET /api/files/uniform-structure/<runId>
 *
 * Same-origin proxy for SHAAM Uniform-Structure ZIP exports (Spec 10).
 * Issuers (Studio) and admins: scoped to the caller's business entity.
 * through the app — the browser never opens a connection to the S3
 * host. That means the bucket can stay private and admins can fetch
 * exports from the same TLS / WAF surface as the rest of the app.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  let row;
  try {
    row = await loadExportForDownload(runId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Export not ready") {
      return NextResponse.json({ error: "Export not ready" }, { status: 404 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!row.s3KeyZip) {
    return NextResponse.json({ error: "Export not ready" }, { status: 404 });
  }

  try {
    const buffer = await downloadFile(row.s3KeyZip);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${runId}.zip"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[files.uniform-structure] download failed", err);
    return NextResponse.json(
      { error: "Failed to load export" },
      { status: 502 },
    );
  }
}
