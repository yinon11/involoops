/** Client-side CSV from plain row objects. UTF-8 BOM for Excel compatibility. */
function escapeCsvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadRowsAsCsv(
  rows: readonly object[],
  filename: string
): void {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) =>
      headers
        .map((h) =>
          escapeCsvCell((row as Record<string, unknown>)[h])
        )
        .join(",")
    ),
  ];

  const body = `\uFEFF${lines.join("\n")}`;
  const blob = new Blob([body], {
    type: "text/csv;charset=utf-8;",
  });
  const safeFilename = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
