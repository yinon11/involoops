import { downloadFile } from "@/lib/storage";

/**
 * `invoice_templates.logo_url` stores one of:
 *   - `null` / empty                 → no logo.
 *   - `s3:<key>`                     → file uploaded by the user; the
 *                                      key lives in our private S3
 *                                      bucket and we serve it through
 *                                      the app, never directly.
 *   - any other value (`https://`,
 *     `http://`, `data:`, …)         → external URL, used verbatim.
 */

const S3_PREFIX = "s3:";

function isStoredS3Ref(value: string): boolean {
  return value.startsWith(S3_PREFIX);
}

function keyOf(stored: string): string {
  return stored.slice(S3_PREFIX.length);
}

/**
 * S3 keys for uploaded logos are always `<userId>/logos/<basename>`
 * (see `src/app/api/upload/logo/route.ts`). The proxy route only needs
 * the basename — it rebuilds the full key from the current session's
 * userId so a stored URL can never be replayed across accounts.
 */
function basenameFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts.length < 2) return null;
  if (parts[parts.length - 2] !== "logos") return null;
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

function contentTypeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export interface ResolveTemplateLogoOptions {
  /**
   * When true, fetch the bytes from S3 and return a `data:` URL. Use
   * this from contexts where the consumer can't ride a session cookie
   * — primarily the Puppeteer-driven PDF pipeline, which renders HTML
   * outside any browser auth context. For browser-rendered previews
   * leave this off so we don't bloat the HTML payload.
   */
  embedAsDataUrl?: boolean;
}

/**
 * Resolve a stored `logo_url` into something an `<img src>` can use.
 *
 * Default behaviour returns a same-origin URL (`/api/files/logo/...`)
 * so the browser hits the app — not the MinIO/S3 host — for the bytes.
 * That keeps the bucket private and avoids cross-host TLS / CORS /
 * presign-signature pitfalls (e.g. Cloudflare proxying mangling SigV4
 * query params, or wildcard certs not covering 4-label subdomains).
 *
 * Pass `{ embedAsDataUrl: true }` for the PDF generator — Puppeteer
 * has no session, so a same-origin URL would 401.
 */
export async function resolveTemplateLogo(
  stored: string | null | undefined,
  options: ResolveTemplateLogoOptions = {},
): Promise<string | null> {
  if (!stored) return null;
  if (!isStoredS3Ref(stored)) return stored;

  const key = keyOf(stored);
  if (!key) return null;

  if (options.embedAsDataUrl) {
    try {
      const buffer = await downloadFile(key);
      return `data:${contentTypeFromKey(key)};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  }

  const name = basenameFromKey(key);
  if (!name) return null;
  return `/api/files/logo/${encodeURIComponent(name)}`;
}
