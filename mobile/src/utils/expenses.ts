import { Directory, File, FileMode, Paths } from "expo-file-system";
import { apiJson, idempotencyKey } from "@/utils/api";

export interface OutboxItem {
  id: string;
  uri: string;
  name: string;
  contentType: string;
}

interface UploadCreated {
  upload_id: string;
  upload: { url: string; method: string; headers: Record<string, string> };
}

interface UploadJob {
  status: string;
  invoice_id: string | null;
  error_message: string | null;
}

function outboxFile(): File {
  return new File(Paths.document, "outbox.json");
}

function contentTypeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

export async function readOutbox(): Promise<OutboxItem[]> {
  try {
    const file = outboxFile();
    if (!file.exists) return [];
    const parsed = JSON.parse(await file.text()) as OutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Unreadable store — e.g. expo-file-system has no web implementation,
    // where `new File()` itself throws. Behave as an empty outbox.
    return [];
  }
}

async function writeOutbox(items: OutboxItem[]): Promise<void> {
  const file = outboxFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(items));
}

/**
 * Copy a picked file into app storage so a failed upload can be retried.
 * Android will not let us read the picker's cache file. Open the shared
 * document read-only and write our own copy.
 */
export async function keepPhoto(uri: string, name: string, knownSize?: number): Promise<OutboxItem> {
  const dir = new Directory(Paths.document, "outbox");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const id = `${Date.now()}`;
  const dest = new File(dir, `${id}-${name.replace(/[^\w.]+/g, "_")}`);
  const src = new File(uri);
  const handle = src.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? knownSize;
    if (size == null || size <= 0) {
      throw new Error("Could not read the selected file");
    }
    const bytes = handle.readBytes(size);
    if (!dest.exists) dest.create();
    dest.write(bytes);
  } finally {
    handle.close();
  }
  const item: OutboxItem = {
    id,
    uri: dest.uri,
    name,
    contentType: contentTypeFor(name),
  };
  const items = await readOutbox();
  items.push(item);
  await writeOutbox(items);
  return item;
}

export async function dropOutboxItem(id: string): Promise<void> {
  const items = await readOutbox();
  const kept = items.filter((item) => item.id !== id);
  const gone = items.find((item) => item.id === id);
  await writeOutbox(kept);
  if (gone) {
    const file = new File(gone.uri);
    if (file.exists) file.delete();
  }
}

export async function uploadExpenseFile(
  item: Pick<OutboxItem, "uri" | "name" | "contentType">,
  onPhase?: (phase: "uploading" | "reading") => void,
): Promise<string> {
  onPhase?.("uploading");
  const file = new File(item.uri);
  const created = await apiJson<UploadCreated>("/api/v1/uploads", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey(),
    },
    body: JSON.stringify({
      file_name: item.name,
      content_type: item.contentType,
      size_bytes: file.size,
    }),
  });

  // The storage host is private. Send the bytes to the app, which writes them.
  await apiJson(`/api/v1/uploads/${created.upload_id}/content`, {
    method: "POST",
    headers: { "content-type": item.contentType },
    body: await file.arrayBuffer(),
  });

  onPhase?.("reading");
  await apiJson(`/api/v1/uploads/${created.upload_id}/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey(),
    },
    body: JSON.stringify({ type: "expense" }),
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = await apiJson<UploadJob>(`/api/v1/uploads/${created.upload_id}`);
    if (job.status === "done" && job.invoice_id) return job.invoice_id;
    if (job.status === "error") {
      throw new Error(job.error_message ?? "Could not read the invoice");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Still reading the invoice. It will appear in Pending.");
}
