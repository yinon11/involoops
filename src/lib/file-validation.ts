/**
 * Server-side file validation helpers.
 *
 * The client `<input accept=…>` filter and the presign-endpoint `contentType`
 * are both user-controlled and must not be trusted. These helpers enforce the
 * real allowlist on the server using magic-byte sniffing.
 */

/** MIME types accepted anywhere we accept user uploads. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
  "application/zip",
  "application/x-zip-compressed",
] as const;

export const ALLOWED_UPLOAD_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "tif",
  "tiff",
  "zip",
] as const;

export type AllowedMime = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

export function isAllowedMime(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(ct);
}

/**
 * Extract a safe extension from a user-supplied filename.
 * Returns null for anything outside the allowlist.
 *
 * Uses the *last* dot segment so `invoice.pdf.html` is treated as `.html` and
 * rejected, not silently accepted as `pdf`.
 */
export function safeExtensionFromFilename(
  filename: string | null | undefined
): (typeof ALLOWED_UPLOAD_EXTENSIONS)[number] | null {
  if (!filename) return null;
  const base = filename.split(/[/\\]/).pop() ?? filename;
  // Take the last extension segment only.
  const lastDot = base.lastIndexOf(".");
  if (lastDot < 0 || lastDot === base.length - 1) return null;
  const ext = base.slice(lastDot + 1).toLowerCase();
  if (!/^[a-z0-9]+$/.test(ext)) return null;
  if ((ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return ext as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];
  }
  return null;
}

/**
 * Strip any path components from a user-supplied filename and clamp length.
 * Never allows `..`, slashes, or control characters into the stored name.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  return base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_").slice(0, 220) || "file";
}

/**
 * Detect the real file type from the first bytes of the buffer.
 * Returns one of the allowed MIME types or null if we can't confirm.
 */
export function detectMimeFromBytes(buffer: Buffer | Uint8Array): AllowedMime | null {
  if (buffer.length < 4) return null;
  const b0 = buffer[0];
  const b1 = buffer[1];
  const b2 = buffer[2];
  const b3 = buffer[3];

  // %PDF
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) {
    return "application/pdf";
  }
  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF"…"WEBP"
  if (
    buffer.length >= 12 &&
    b0 === 0x52 &&
    b1 === 0x49 &&
    b2 === 0x46 &&
    b3 === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  // TIFF: 49 49 2A 00 (little-endian) or 4D 4D 00 2A (big-endian)
  if (
    (b0 === 0x49 && b1 === 0x49 && b2 === 0x2a && b3 === 0x00) ||
    (b0 === 0x4d && b1 === 0x4d && b2 === 0x00 && b3 === 0x2a)
  ) {
    return "image/tiff";
  }
  // ZIP: PK\x03\x04 (PK\x05\x06 and PK\x07\x08 are empty/spanned — reject)
  if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) {
    return "application/zip";
  }

  return null;
}

/**
 * Validate that the buffer's actual content matches one of the allowed MIME
 * types, and (optionally) that it matches the declared contentType.
 *
 * Declared contentType is treated as a weak hint only; the magic-byte result
 * is authoritative.
 */
export function validateUploadedBuffer(
  buffer: Buffer | Uint8Array,
  declaredContentType?: string | null
): { ok: true; mime: AllowedMime } | { ok: false; reason: string } {
  const mime = detectMimeFromBytes(buffer);
  if (!mime) {
    return { ok: false, reason: "Unsupported or unrecognized file type" };
  }
  // JPEG may be declared as image/jpg; normalize before comparison.
  if (declaredContentType) {
    const declared = declaredContentType.toLowerCase().split(";")[0].trim();
    const normalized = declared === "image/jpg" ? "image/jpeg" : declared;
    const zipAliases = new Set<string>([
      "application/zip",
      "application/x-zip-compressed",
    ]);
    const matches =
      normalized === mime ||
      (mime === "application/zip" && zipAliases.has(normalized));
    if (!matches) {
      return {
        ok: false,
        reason: `Declared content type (${declared}) does not match file contents (${mime})`,
      };
    }
  }
  return { ok: true, mime };
}
