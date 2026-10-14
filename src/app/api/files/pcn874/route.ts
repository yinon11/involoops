import { NextRequest, NextResponse } from "next/server";
import { requireUniformStructureActor } from "@/lib/uniform-structure/access";
import { generatePcn874 } from "@/lib/pcn874/load";
import { Pcn874Error } from "@/lib/pcn874/build";
import { MissingExchangeRateError } from "@/lib/outbound/statutory-ils-amounts";
import { listOpenAllocationDrafts } from "@/lib/outbound/open-allocation-drafts";
import { todayInIsrael } from "@/lib/datetime/today";

export const runtime = "nodejs";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * GET `?month=YYYY-MM` — the PCN874 file (sales side) for that month, built
 * on demand from the issued documents. `&format=json` returns the summary
 * and the notes instead, so the seller can check the figures before
 * downloading (the ITA recommends showing at least the header totals).
 *
 * Same access as the Uniform Structure export: `document:issue`, or a
 * platform admin, on the caller's own business.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireUniformStructureActor();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  let file;
  try {
    file = await generatePcn874({
      businessEntityId: actor.businessEntityId,
      month,
      generatedOn: todayInIsrael(),
    });
  } catch (err) {
    if (err instanceof Pcn874Error || err instanceof MissingExchangeRateError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[files.pcn874]", err);
    return NextResponse.json({ error: "Failed to build the PCN874 file" }, { status: 500 });
  }

  if (req.nextUrl.searchParams.get("format") === "json") {
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const openDrafts = await listOpenAllocationDrafts({
      businessEntityId: actor.businessEntityId,
      periodStart: `${month}-01`,
      periodEnd: `${month}-${String(lastDay).padStart(2, "0")}`,
    });
    return NextResponse.json(
      { month, totals: file.totals, notes: file.notes, openDrafts },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return new NextResponse(file.text, {
    headers: {
      "Content-Type": "text/plain; charset=us-ascii",
      // The ITA expects the file under this exact name.
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
