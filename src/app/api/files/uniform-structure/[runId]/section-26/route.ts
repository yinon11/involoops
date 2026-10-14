import { NextRequest, NextResponse } from "next/server";
import { downloadFile } from "@/lib/storage";
import { loadExportForDownload } from "@/lib/uniform-structure/export-file-auth";
import { htmlToPdfBuffer } from "@/lib/uniform-structure/print-pdf";
import {
  buildSection26ReportFromBuffers,
  renderSection26ReportHtml,
} from "@/lib/uniform-structure/section-26-report";

export const runtime = "nodejs";

const RUN_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;

/** GET — ITA Uniform Structure §2.6(b) validation print (PDF). */
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
  if (!row.s3KeyIni || !row.s3KeyBkmvdata) {
    return NextResponse.json({ error: "Export files missing" }, { status: 404 });
  }

  try {
    const [iniContent, bkmvdataContent] = await Promise.all([
      downloadFile(row.s3KeyIni),
      downloadFile(row.s3KeyBkmvdata),
    ]);
    const report = await buildSection26ReportFromBuffers({
      iniContent,
      bkmvdataContent,
    });
    const html = renderSection26ReportHtml(report, 1, 1);
    const pdf = await htmlToPdfBuffer(html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${runId}-section-2-6.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[files.uniform-structure.section-26]", err);
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 502 });
  }
}
