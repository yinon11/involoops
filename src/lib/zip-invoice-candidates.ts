/**
 * Shared rules for which files inside a ZIP count as invoice uploads.
 * Used by the server batch processor and the client (per-file upload UI).
 */

import JSZip from "jszip";

export const MAX_ZIP_FILES = 500;
/** Sum of uncompressed PDF/image bytes inside the ZIP (not the .zip file size). */
export const MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_SINGLE_ENTRY_BYTES = 25 * 1024 * 1024;

export const INV_NAME_PATTERN = /\.(pdf|png|jpe?g|webp|tiff?)$/i;

export function safeBasename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? path;
  return base.replace(/[/\\]/g, "_").slice(0, 220);
}

export function mimeForExtension(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
    tiff: "image/tiff",
    tif: "image/tiff",
  };
  return map[e] ?? "application/octet-stream";
}

export type ZipInvoiceCandidate = { name: string; data: Uint8Array };

/**
 * Lists invoice-like entries from a ZIP archive (same filtering as server-side batch).
 */
export async function parseZipInvoiceCandidates(
  zipInput: ArrayBuffer | Buffer
): Promise<ZipInvoiceCandidate[]> {
  const zip = await JSZip.loadAsync(zipInput);
  const candidates: ZipInvoiceCandidate[] = [];
  let total = 0;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (path.includes("__MACOSX") || path.includes("..")) continue;

    const name = safeBasename(path);
    if (!name || name.startsWith(".") || /^Thumbs\.db$/i.test(name)) {
      continue;
    }
    if (!INV_NAME_PATTERN.test(name)) continue;

    const raw = await entry.async("uint8array");
    if (raw.length === 0 || raw.length > MAX_SINGLE_ENTRY_BYTES) continue;
    if (total + raw.length > MAX_ZIP_TOTAL_BYTES) {
      const mb = Math.round(MAX_ZIP_TOTAL_BYTES / (1024 * 1024));
      throw new Error(
        `ZIP exceeds the ${mb} MB limit on combined size of invoice files after extraction (PDF/images inside the archive), not the .zip file size. Split the archive or remove non-invoice entries.`
      );
    }
    if (candidates.length >= MAX_ZIP_FILES) {
      throw new Error(
        `ZIP archive contains more than ${MAX_ZIP_FILES} supported invoice files. Please split it into smaller archives.`
      );
    }

    total += raw.length;
    candidates.push({ name, data: raw });
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}
