import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { and, eq, inArray } from "drizzle-orm";
import JSZip from "jszip";
import { auth } from "@/auth";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { downloadFile } from "@/lib/storage";
import { resolveStorageKeyFromFileUrl } from "@/lib/storage-key";
import {
  mimeForExtension,
  safeBasename,
} from "@/lib/zip-invoice-candidates";

const MAX_IDS = 500;
/**
 * Safety cap on total uncompressed bytes pulled into the ZIP. When hit, the
 * remaining entries are emitted as zero-byte files so the archive stays
 * structurally valid — easier to diagnose than a truncated stream.
 */
const MAX_ZIP_INPUT_BYTES = 500 * 1024 * 1024; // 500 MB

type Deferred = {
  promise: Promise<Buffer>;
  resolve: (v: Buffer) => void;
};

function deferred(): Deferred {
  let resolve!: (v: Buffer) => void;
  const promise = new Promise<Buffer>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * POST /api/invoices/download
 * Body: { ids: string[] }
 *
 * Returns the file bytes for a single invoice, or a streamed ZIP archive when
 * more than one id is provided. For the ZIP path, file buffers are pulled
 * from S3 sequentially and piped through JSZip's streaming generator — peak
 * memory stays ~1 file + JSZip's chunk buffer regardless of selection size.
 *
 * SSRF-safe: storage keys are resolved server-side and must fall under the
 * caller's user prefix (defense in depth — ownership is also enforced by the
 * SQL `userId` filter).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawIds = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(rawIds)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }
  const ids = Array.from(
    new Set(rawIds.filter((v): v is string => typeof v === "string" && v.length > 0))
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Too many ids (max ${MAX_IDS})` },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      id: invoices.id,
      fileUrl: invoices.fileUrl,
      fileName: invoices.fileName,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(invoices)
    .where(and(eq(invoices.userId, userId), inArray(invoices.id, ids)));

  const withFiles = rows.filter((r) => r.fileUrl?.trim());
  if (withFiles.length === 0) {
    return NextResponse.json(
      { error: "No downloadable files in selection" },
      { status: 404 }
    );
  }

  if (withFiles.length === 1) {
    const r = withFiles[0];
    const key = resolveStorageKeyFromFileUrl(r.fileUrl as string);
    if (!key || !key.startsWith(`${userId}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const buffer = await downloadFile(key);
      const ext = (r.fileName ?? key).split(".").pop() ?? "";
      const contentType = mimeForExtension(ext);
      const filename = safeBasename(
        r.fileName ?? `invoice-${r.id}.${ext || "bin"}`
      );
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (e) {
      console.error("invoice download failed:", e);
      return NextResponse.json({ error: "Download failed" }, { status: 500 });
    }
  }

  // Multiple files: stream a ZIP.
  //
  // JSZip accepts Promise<Buffer> inputs and awaits them lazily during
  // generation. We register each entry up front with a deferred promise, then
  // a single background worker resolves those promises one at a time. With
  // `streamFiles: true` JSZip consumes them in order, so downloads, zipping
  // and the HTTP response all progress in lockstep.
  const zip = new JSZip();
  const usedNames = new Set<string>();
  const entries: { key: string; deferred: Deferred }[] = [];

  for (const r of withFiles) {
    const key = resolveStorageKeyFromFileUrl(r.fileUrl as string);
    if (!key || !key.startsWith(`${userId}/`)) continue;
    let name = safeBasename(r.fileName ?? `invoice-${r.id}`);
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      name = `${stem}-${r.id.slice(0, 8)}${ext}`;
    }
    usedNames.add(name);
    const d = deferred();
    zip.file(name, d.promise);
    entries.push({ key, deferred: d });
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No files could be downloaded" },
      { status: 500 }
    );
  }

  let capHit = false;
  let totalBytes = 0;
  void (async () => {
    for (const entry of entries) {
      try {
        if (capHit) {
          entry.deferred.resolve(Buffer.alloc(0));
          continue;
        }
        const buf = await downloadFile(entry.key);
        if (totalBytes + buf.length > MAX_ZIP_INPUT_BYTES) {
          capHit = true;
          entry.deferred.resolve(Buffer.alloc(0));
          continue;
        }
        totalBytes += buf.length;
        entry.deferred.resolve(buf);
      } catch (e) {
        // Never reject — JSZip would abort the whole stream. Empty entry
        // keeps the archive usable for the other files.
        console.error(`skip ${entry.key}:`, e);
        entry.deferred.resolve(Buffer.alloc(0));
      }
    }
  })();

  // `generateNodeStream` returns a Node Readable at runtime even though the
  // declared type is the minimal `NodeJS.ReadableStream`.
  const nodeStream = zip.generateNodeStream({
    type: "nodebuffer",
    streamFiles: true,
  }) as unknown as Readable;

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => {
        console.error("zip stream error:", err);
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="invoices-${today}.zip"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
