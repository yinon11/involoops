import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { moveinExports } from "@/db/schema";
import { downloadFile } from "@/lib/storage";
import { canDownloadMoveinExport } from "@/features/generator/actions/movein-export-actions";

export const runtime = "nodejs";

const RUN_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  if (!(await canDownloadMoveinExport(runId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db
    .select({
      status: moveinExports.status,
      s3KeyZip: moveinExports.s3KeyZip,
    })
    .from(moveinExports)
    .where(eq(moveinExports.runId, runId))
    .limit(1);

  if (!row || row.status !== "DONE" || !row.s3KeyZip) {
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
    console.error("[files.movein] download failed", err);
    return NextResponse.json(
      { error: "Failed to load export" },
      { status: 502 },
    );
  }
}
