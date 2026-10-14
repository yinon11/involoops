/**
 * Attachment discovery in a Gmail API message payload.
 *
 * Gmail nests parts recursively (multipart/mixed → multipart/alternative →
 * etc.). An "attachment" is any part where `body.attachmentId` is set —
 * we walk the whole tree so nested attachments aren't missed.
 *
 * No filtering by extension/MIME here — that's the caller's job using
 * `safeExtensionFromFilename` from lib/file-validation, applied AFTER
 * the bytes are downloaded so we can magic-byte-validate too.
 */

import type { gmail_v1 } from "@googleapis/gmail";

export interface AttachmentRef {
  attachmentId: string;
  filename: string;
  mimeType: string;
  /** Approximate size in bytes (Gmail reports the encoded size). */
  size: number;
}

export function listAttachments(
  message: gmail_v1.Schema$Message,
): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  walk(message.payload ?? null, out);
  return out;
}

function walk(
  part: gmail_v1.Schema$MessagePart | null,
  out: AttachmentRef[],
): void {
  if (!part) return;

  const attachmentId = part.body?.attachmentId;
  // A part counts as an attachment iff the body has an attachmentId.
  // Filename can be empty (some senders attach unnamed PDFs); fall back
  // to a synthesised name so the file-validation layer still works.
  if (typeof attachmentId === "string" && attachmentId.length > 0) {
    out.push({
      attachmentId,
      filename: part.filename?.trim() || "attachment.bin",
      mimeType: part.mimeType ?? "application/octet-stream",
      size: typeof part.body?.size === "number" ? part.body.size : 0,
    });
  }

  for (const child of part.parts ?? []) {
    walk(child, out);
  }
}
