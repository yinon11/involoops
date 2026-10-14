export function uniformStructureZipHref(runId: string): string {
  return `/api/files/uniform-structure/${encodeURIComponent(runId)}`;
}

export function uniformStructurePrintHref(
  runId: string,
  kind: "section-26" | "appendix-54",
): string {
  return `/api/files/uniform-structure/${encodeURIComponent(runId)}/${kind}`;
}
