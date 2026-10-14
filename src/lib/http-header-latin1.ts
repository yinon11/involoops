/**
 * `fetch()` Request headers must be ISO-8859-1 (ByteString). Unicode names or
 * invisible characters (e.g. U+200B ZWSP) in {@code X-File-Name} throw:
 * "Failed to read the 'headers' property from 'RequestInit': String contains
 * non ISO-8859-1 code point."
 */

export function latin1SafeContentTypeHeader(contentType: string): string {
  const base = contentType.split(";")[0]?.trim() ?? "";
  if (!base) return "application/octet-stream";
  for (let i = 0; i < base.length; i++) {
    if (base.charCodeAt(i) > 0xff) return "application/octet-stream";
  }
  return base;
}

/** ASCII/latin-1 filename safe for HTTP headers; preserves extension when possible. */
export function latin1SafeFileNameForUploadHeader(
  fileName: string,
  maxLen = 512,
): string {
  const trimmed = fileName.normalize("NFC").trim().slice(0, maxLen);
  if (!trimmed) return "upload";

  let out = "";
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0)!;
    out += cp <= 0xff ? ch : "_";
  }

  out = out.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return out.length > 0 ? out : "upload";
}
