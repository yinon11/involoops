import { db } from "@/db";
import { emailTemplates } from "@/db/schema/email-templates";
import { eq, and } from "drizzle-orm";
import type { RenderedEmail } from "./ses";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render an email template by code + locale, replacing placeholders.
 *
 * Two placeholder shapes (Mustache-style):
 *   {{var}}    — escaped substitution (default; safe for user-supplied values).
 *   {{{var}}}  — raw substitution; use only for trusted, pre-built HTML
 *                fragments such as the per-invoice cards in the
 *                invoice-scan-confirm template.
 *
 * The special placeholder {{amazonSESUnsubscribeUrl}} is preserved for SES.
 *
 * If the requested locale row doesn't exist (or is inactive), falls back to
 * the English row so partial translations are safe to ship. When no row is
 * found at all, returns null and the caller must treat the send as failed.
 */
export async function renderTemplate(
  templateCode: string,
  locale: string,
  variables: Record<string, string>,
): Promise<(RenderedEmail & { templateId: string }) | null> {
  const requested = await db.query.emailTemplates.findFirst({
    where: and(
      eq(emailTemplates.code, templateCode),
      eq(emailTemplates.locale, locale),
      eq(emailTemplates.isActive, true),
    ),
  });

  const template =
    requested ??
    (locale === "en"
      ? null
      : await db.query.emailTemplates.findFirst({
          where: and(
            eq(emailTemplates.code, templateCode),
            eq(emailTemplates.locale, "en"),
            eq(emailTemplates.isActive, true),
          ),
        }));

  if (!template) {
    console.error(
      `[TemplateRenderer] Template not found: ${templateCode} (locale=${locale})`,
    );
    return null;
  }

  function replaceVars(text: string, escape: boolean): string {
    // Triple-brace first — raw HTML, never escaped. Used for trusted
    // pre-built fragments (e.g. table rows assembled in code).
    let out = text.replace(/\{\{\{(\w+)\}\}\}/g, (match, key) => {
      const value = variables[key];
      return value !== undefined ? value : match;
    });
    // Double-brace — standard substitution; HTML body escapes, subject/text
    // do not (callers shouldn't put markup in subjects).
    out = out.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key === "amazonSESUnsubscribeUrl") return match;
      const value = variables[key];
      if (value === undefined) return match;
      return escape ? escapeHtml(value) : value;
    });
    return out;
  }

  return {
    templateId: template.id,
    subject: replaceVars(template.subject, false),
    html: replaceVars(template.bodyHtml, true),
    text: template.bodyText ? replaceVars(template.bodyText, false) : undefined,
  };
}
