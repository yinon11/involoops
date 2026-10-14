import { NextRequest, NextResponse } from "next/server";
import { downloadFile } from "@/lib/storage";
import {
  buildAppendix54ReportFromIniBuffer,
  renderAppendix54ReportHtml,
} from "@/lib/uniform-structure/appendix-54-report";
import { loadExportForDownload } from "@/lib/uniform-structure/export-file-auth";
import { htmlToPdfBuffer } from "@/lib/uniform-structure/print-pdf";

export const runtime = "nodejs";

const RUN_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;

/** GET — ITA Uniform Structure Appendix 4 §5.4 completion report (PDF). */
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
  if (!row.s3KeyIni) {
    return NextResponse.json({ error: "Export files missing" }, { status: 404 });
  }

  try {
    const iniContent = await downloadFile(row.s3KeyIni);
    const report = await buildAppendix54ReportFromIniBuffer(iniContent);
    const html = renderAppendix54ReportHtml(report);
    const pdf = await htmlToPdfBuffer(html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${runId}-appendix-4-5-4.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[files.uniform-structure.appendix-54]", err);
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 502 });
  }
}
