/**
 * Client-side helper to export an array of plain row objects to an
 * `.xlsx` workbook and trigger a download.
 *
 * Loads the `xlsx` module lazily so it stays out of the main bundle
 * until a user actually exports a table.
 */
export async function downloadRowsAsXlsx(
  rows: readonly object[],
  {
    filename,
    sheetName = "Sheet1",
  }: { filename: string; sheetName?: string }
): Promise<void> {
  if (rows.length === 0) return;

  const XLSX = await import("xlsx");

  const worksheet = XLSX.utils.json_to_sheet(rows as Record<string, unknown>[]);

  // Auto-size columns based on header + cell content length.
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  worksheet["!cols"] = headers.map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.map((row) =>
        String((row as Record<string, unknown>)[key] ?? "").length
      )
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));

  const safeFilename = filename.endsWith(".xlsx")
    ? filename
    : `${filename}.xlsx`;
  XLSX.writeFile(workbook, safeFilename);
}
