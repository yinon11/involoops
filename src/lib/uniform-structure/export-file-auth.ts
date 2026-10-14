import type { uniformStructureExports } from "@/db/schema";
import { getUniformStructureExportForActor } from "./access";

export async function loadExportForDownload(
  runId: string,
): Promise<typeof uniformStructureExports.$inferSelect> {
  const { exportRow } = await getUniformStructureExportForActor(runId);
  if (exportRow.status !== "DONE") {
    throw new Error("Export not ready");
  }
  return exportRow;
}
