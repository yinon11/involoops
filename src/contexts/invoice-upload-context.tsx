"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  latin1SafeContentTypeHeader,
  latin1SafeFileNameForUploadHeader,
} from "@/lib/http-header-latin1";
import {
  mimeForExtension,
  parseZipInvoiceCandidates,
} from "@/lib/zip-invoice-candidates";
import { usePendingCount } from "@/contexts/pending-count-context";
import { useI18n } from "@/lib/i18n/client";

export type FileStatus =
  | "uploading"
  | "processing"
  | "done"
  | "error"
  | "cancelled"
  | "interrupted";

export interface TrackedFile {
  id: string;
  name: string;
  status: FileStatus;
  progress: number;
  error?: string;
  /**
   * Stable machine-readable code from the failing endpoint (e.g.
   * "anthropic_model_access"). Lets the UI render targeted CTAs (like
   * "Use platform key & retry") instead of just a flat error string.
   */
  errorCode?: string;
  invoiceId?: string;
  /** When the upload failed because the file is a duplicate, this is the ID of the existing invoice. */
  duplicateInvoiceId?: string;
  /**
   * Soft duplicate warning: invoice was inserted successfully, but its invoice
   * number matches another invoice in the user's account. Points at that other
   * invoice so the user can inspect the potential duplicate.
   */
  possibleDuplicateInvoiceId?: string;
  /** Present when `status === "done"` — from process API */
  invoiceStatus?: "processing" | "pending" | "approved" | "rejected";
  vendorDisplayName?: string | null;
  invoiceDate?: string | null;
  amount?: string;
  currency?: string;
  vatAmount?: string | null;
  /**
   * Set when the upload was bytes-stored in MinIO but the server-side
   * process step failed in a recoverable way. Letting the UI re-call
   * `/api/upload/process` for the same key avoids re-uploading the bytes.
   */
  retryContext?: {
    fileKey: string;
    fileName: string;
  };
}

type InvoiceUploadContextValue = {
  files: TrackedFile[];
  hydrated: boolean;
  zipBatchActive: boolean;
  allDone: boolean;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
  /** Returns how many files were accepted and queued (0 if none). */
  handleFiles: (fileList: FileList | File[]) => number;
  handleDrop: (e: DragEvent) => void;
  stopZipProcessing: () => void;
  clearUploadList: () => void;
  /**
   * Re-run `/api/upload/process` for a previously failed row whose bytes are
   * already in MinIO. Used by recoverable error CTAs (e.g. "Use platform
   * key & retry"). Resolves to "ok" / "error" / "missing" (no retry context).
   */
  retryProcess: (id: string) => Promise<"ok" | "error" | "missing">;
};

const InvoiceUploadContext = createContext<InvoiceUploadContextValue | null>(
  null
);

function storageKey(userId: string) {
  return `invoice-app-upload-queue-v1:${userId}`;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

function normalizeAfterReload(files: TrackedFile[]): TrackedFile[] {
  return files.map((f) => {
    if (f.status === "uploading" || f.status === "processing") {
      return {
        ...f,
        status: "interrupted" as const,
        progress: 0,
        error:
          "Page was reloaded — this upload may not have finished. Check Invoices.",
      };
    }
    return f;
  });
}

export function InvoiceUploadProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [zipBatchActive, setZipBatchActive] = useState(false);
  const zipAbortControllersRef = useRef<AbortController[]>([]);
  const { refresh: refreshPendingCount } = usePendingCount();
  const { dict } = useI18n();
  // Mirror of `files` so async callbacks (e.g. retryProcess) can read the
  // current row by id without taking a stale closure on the state.
  const filesRef = useRef<TrackedFile[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Hydrate from sessionStorage (client-only); reset when user changes
  useEffect(() => {
    setHydrated(false);
    try {
      const raw = sessionStorage.getItem(storageKey(userId));
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setFiles(normalizeAfterReload(parsed as TrackedFile[]));
        } else {
          setFiles([]);
        }
      } else {
        setFiles([]);
      }
    } catch {
      setFiles([]);
    }
    setHydrated(true);
  }, [userId]);

  // Persist queue whenever it changes (after initial hydrate)
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (files.length === 0) {
        sessionStorage.removeItem(storageKey(userId));
      } else {
        sessionStorage.setItem(storageKey(userId), JSON.stringify(files));
      }
    } catch {
      // quota / private mode
    }
  }, [files, hydrated, userId]);

  const updateFile = useCallback(
    (id: string, updates: Partial<TrackedFile>) => {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
      );
    },
    []
  );

  const processOneUpload = useCallback(
    async (params: {
      displayName: string;
      blob: Blob;
      contentType: string;
      presignFileName: string;
      signal?: AbortSignal;
    }): Promise<"ok" | "limit" | "error" | "cancelled"> => {
      const { displayName, blob, contentType, presignFileName, signal } =
        params;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const tracked: TrackedFile = {
        id,
        name: displayName,
        status: "uploading",
        progress: 0,
      };

      setFiles((prev) => [...prev, tracked]);

      try {
        // Single round-trip: the app accepts the bytes and writes them
        // to MinIO over the internal Compose network. The browser never
        // talks to the storage host directly — keeps the bucket private
        // and avoids cross-host TLS / CORS / SigV4 friction.
        const uploadRes = await fetch("/api/upload/file", {
          method: "POST",
          headers: {
            "Content-Type": latin1SafeContentTypeHeader(contentType),
            "X-File-Name": latin1SafeFileNameForUploadHeader(presignFileName),
          },
          body: blob,
          signal,
        });

        if (!uploadRes.ok) {
          // Surface the server's reason (e.g. plan-limit reached) instead
          // of a generic "Upload failed" — the caller renders
          // `error.message` directly on the file row.
          const err = await uploadRes.json().catch(() => ({}));
          const message =
            typeof err.error === "string" ? err.error : "File upload failed";
          // A 403 at upload time means the monthly plan limit was hit.
          // Return a distinct outcome so a batch caller (ZIP loop,
          // multi-file drop) can abort the rest of the queue instead
          // of repeating the same error on every remaining row.
          if (uploadRes.status === 403) {
            updateFile(id, { status: "error", error: message });
            return "limit";
          }
          throw new Error(message);
        }

        const { key } = await uploadRes.json();

        updateFile(id, { progress: 60, status: "processing" });

        const processRes = await fetch("/api/upload/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileKey: key, fileName: presignFileName }),
          signal,
        });

        if (!processRes.ok) {
          const err = await processRes.json().catch(() => ({}));
          const errorCode =
            typeof err.code === "string" ? (err.code as string) : undefined;
          let message =
            typeof err.error === "string" ? err.error : "Processing failed";
          if (errorCode === "server_schema_mismatch") {
            message = dict.upload.errors.serverUpdating;
          } else if (
            message === "Processing failed" ||
            message === "Failed to process file" ||
            errorCode === "process_failed"
          ) {
            message = dict.upload.errors.processFailedDetail;
          }
          const duplicateInvoiceId =
            processRes.status === 409 &&
            typeof err.existingInvoiceId === "string"
              ? err.existingInvoiceId
              : undefined;
          // Bytes are already in MinIO, so a recoverable error (e.g. the
          // user's BYOK key can't access the extraction model) can be
          // retried via the same fileKey without re-uploading. Save the
          // context so the UI can offer "Switch keys & retry".
          const retryContext = errorCode
            ? { fileKey: key as string, fileName: presignFileName }
            : undefined;
          updateFile(id, {
            status: "error",
            error: message,
            errorCode,
            duplicateInvoiceId,
            retryContext,
          });
          // Process-time 403 is the plan-limit case (single-file quota
          // refusal, or a ZIP whose internal file count exceeds what fits).
          // Signal the batch caller so it can stop queuing more files.
          if (processRes.status === 403) return "limit";
          return "error";
        }

        const data = await processRes.json();

        if (data.batch === true) {
          throw new Error("Unexpected batch response");
        }

        const inv = data.invoice as {
          id: string;
          status: string;
          invoiceDate: string | null;
          amount: string;
          currency: string | null;
          vatAmount: string | null;
          suggestedVendorName: string | null;
        };

        const vendorDisplayName: string | null =
          typeof data.vendorDisplayName === "string"
            ? data.vendorDisplayName
            : (inv.suggestedVendorName ?? null);

        const possibleDuplicateInvoiceId: string | undefined =
          typeof data.possibleDuplicateInvoiceId === "string"
            ? data.possibleDuplicateInvoiceId
            : undefined;

        updateFile(id, {
          progress: 100,
          status: "done",
          invoiceId: inv.id,
          possibleDuplicateInvoiceId,
          invoiceStatus:
            inv.status === "approved" ||
            inv.status === "pending" ||
            inv.status === "rejected" ||
            inv.status === "processing"
              ? inv.status
              : "pending",
          vendorDisplayName,
          invoiceDate: inv.invoiceDate ?? null,
          amount: String(inv.amount ?? "0"),
          currency: inv.currency ?? "ILS",
          vatAmount:
            inv.vatAmount != null && inv.vatAmount !== ""
              ? String(inv.vatAmount)
              : null,
        });
        // A newly uploaded invoice lands in `pending` status. Refresh the nav
        // badge from the server — concurrent uploads all call this and the
        // provider's request counter ensures only the latest authoritative
        // count is applied.
        void refreshPendingCount();
        return "ok";
      } catch (err) {
        if (isAbortError(err)) {
          updateFile(id, {
            status: "cancelled",
            progress: 0,
            error: "Stopped",
          });
          return "cancelled";
        }
        updateFile(id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
        return "error";
      }
    },
    [updateFile, refreshPendingCount, dict.upload.errors]
  );

  const processFile = useCallback(
    async (file: File) => {
      const isZip =
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed" ||
        file.name.toLowerCase().endsWith(".zip");

      if (isZip) {
        // Refuse the ZIP up-front if the user has already used every
        // slot on their monthly plan. Without this the browser would
        // decompress the archive, loop each entry through the upload
        // endpoint, take a 403 on the first one, and abort — producing
        // at least one confusing "Monthly invoice limit reached" row
        // even though we knew before unpacking that nothing could
        // succeed.
        try {
          const usageRes = await fetch("/api/upload/usage", {
            method: "GET",
            cache: "no-store",
          });
          if (usageRes.ok) {
            const usage = (await usageRes.json()) as {
              allowed?: boolean;
              current?: number;
              limit?: number;
              planName?: string;
            };
            if (usage.allowed === false) {
              const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
              setFiles((prev) => [
                ...prev,
                {
                  id,
                  name: file.name,
                  status: "error",
                  progress: 0,
                  error: `Monthly invoice limit reached (${usage.current ?? "?"}/${usage.limit ?? "?"} on ${usage.planName ?? "your plan"})`,
                },
              ]);
              return;
            }
          }
          // If the usage probe itself fails (network, auth), fall
          // through to the normal flow — the upload/process checks
          // remain the authoritative gate.
        } catch {
          // Same: soft-fail and let the per-file flow handle it.
        }

        let candidates: Awaited<ReturnType<typeof parseZipInvoiceCandidates>>;
        try {
          candidates = await parseZipInvoiceCandidates(await file.arrayBuffer());
        } catch (err) {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          setFiles((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              status: "error",
              progress: 0,
              error:
                err instanceof Error && err.message
                  ? err.message
                  : "Invalid or unreadable ZIP archive",
            },
          ]);
          return;
        }

        if (candidates.length === 0) {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          setFiles((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              status: "error",
              progress: 0,
              error:
                "No supported invoice files found in the ZIP (use PDF or images: PNG, JPEG, WebP, TIFF).",
            },
          ]);
          return;
        }

        const zipAbort = new AbortController();
        zipAbortControllersRef.current.push(zipAbort);
        setZipBatchActive(true);

        try {
          for (const { name, data } of candidates) {
            if (zipAbort.signal.aborted) {
              break;
            }
            const ext = name.includes(".")
              ? name.slice(name.lastIndexOf(".") + 1)
              : "pdf";
            const contentType = mimeForExtension(ext);
            const blob = new Blob([new Uint8Array(data)], { type: contentType });
            const outcome = await processOneUpload({
              displayName: name,
              blob,
              contentType,
              presignFileName: name,
              signal: zipAbort.signal,
            });
            // First file that hits the monthly plan limit ends the
            // batch. Subsequent files in the same ZIP would all get
            // the same 403 from /api/upload/file; rendering "Monthly
            // invoice limit
            // reached" on every row in a 17-item ZIP is noise. Abort so
            // the loop's next iteration short-circuits at the top, and
            // no further rows are added to the queue.
            if (outcome === "limit") {
              zipAbort.abort();
              break;
            }
          }
        } finally {
          zipAbortControllersRef.current =
            zipAbortControllersRef.current.filter((c) => c !== zipAbort);
          setZipBatchActive(zipAbortControllersRef.current.length > 0);
        }
        return;
      }

      const contentType =
        file.type ||
        mimeForExtension(
          file.name.includes(".")
            ? file.name.slice(file.name.lastIndexOf(".") + 1)
            : "pdf"
        );

      await processOneUpload({
        displayName: file.name,
        blob: file,
        contentType,
        presignFileName: file.name,
      });
    },
    [processOneUpload]
  );

  const handleFiles = useCallback(
    (fileList: FileList | File[]): number => {
      const ACCEPTED_TYPES = [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/tiff",
        "application/zip",
        "application/x-zip-compressed",
      ];
      const accepted = Array.from(fileList).filter((f) => {
        if (ACCEPTED_TYPES.includes(f.type)) return true;
        return f.name.toLowerCase().endsWith(".zip");
      });
      if (accepted.length === 0) return 0;
      accepted.forEach(processFile);
      return accepted.length;
    },
    [processFile]
  );

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        void handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const stopZipProcessing = useCallback(() => {
    for (const ac of zipAbortControllersRef.current) {
      ac.abort();
    }
  }, []);

  const clearUploadList = useCallback(() => {
    setFiles([]);
  }, []);

  /**
   * Re-call `/api/upload/process` for a row that previously failed at the
   * processing stage. The bytes are already in MinIO under `fileKey`, so we
   * skip the re-upload entirely. Used by recoverable-error CTAs (currently:
   * "Use platform key & retry" after the user's BYOK key was found to lack
   * extraction-model access).
   */
  const retryProcess = useCallback(
    async (id: string): Promise<"ok" | "error" | "missing"> => {
      const target = filesRef.current.find((f) => f.id === id);
      if (!target?.retryContext) return "missing";
      const { fileKey, fileName } = target.retryContext;

      updateFile(id, {
        status: "processing",
        progress: 60,
        error: undefined,
        errorCode: undefined,
        duplicateInvoiceId: undefined,
      });

      try {
        const processRes = await fetch("/api/upload/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileKey, fileName }),
        });

        if (!processRes.ok) {
          const err = await processRes.json().catch(() => ({}));
          const errorCode =
            typeof err.code === "string" ? (err.code as string) : undefined;
          let message =
            typeof err.error === "string" ? err.error : "Processing failed";
          if (errorCode === "server_schema_mismatch") {
            message = dict.upload.errors.serverUpdating;
          } else if (
            message === "Processing failed" ||
            message === "Failed to process file" ||
            errorCode === "process_failed"
          ) {
            message = dict.upload.errors.processFailedDetail;
          }
          const duplicateInvoiceId =
            processRes.status === 409 &&
            typeof err.existingInvoiceId === "string"
              ? err.existingInvoiceId
              : undefined;
          updateFile(id, {
            status: "error",
            error: message,
            errorCode,
            duplicateInvoiceId,
            retryContext: errorCode ? { fileKey, fileName } : undefined,
          });
          return "error";
        }

        const data = await processRes.json();
        const inv = data.invoice as {
          id: string;
          status: string;
          invoiceDate: string | null;
          amount: string;
          currency: string | null;
          vatAmount: string | null;
          suggestedVendorName: string | null;
        };
        const vendorDisplayName: string | null =
          typeof data.vendorDisplayName === "string"
            ? data.vendorDisplayName
            : (inv.suggestedVendorName ?? null);
        const possibleDuplicateInvoiceId: string | undefined =
          typeof data.possibleDuplicateInvoiceId === "string"
            ? data.possibleDuplicateInvoiceId
            : undefined;

        updateFile(id, {
          progress: 100,
          status: "done",
          invoiceId: inv.id,
          possibleDuplicateInvoiceId,
          invoiceStatus:
            inv.status === "approved" ||
            inv.status === "pending" ||
            inv.status === "rejected" ||
            inv.status === "processing"
              ? inv.status
              : "pending",
          vendorDisplayName,
          invoiceDate: inv.invoiceDate ?? null,
          amount: String(inv.amount ?? "0"),
          currency: inv.currency ?? "ILS",
          vatAmount:
            inv.vatAmount != null && inv.vatAmount !== ""
              ? String(inv.vatAmount)
              : null,
          retryContext: undefined,
        });
        void refreshPendingCount();
        return "ok";
      } catch (err) {
        updateFile(id, {
          status: "error",
          error: err instanceof Error ? err.message : "Retry failed",
          retryContext: { fileKey, fileName },
        });
        return "error";
      }
    },
    [updateFile, refreshPendingCount, dict.upload.errors]
  );

  const allDone = useMemo(
    () =>
      files.length > 0 &&
      files.every(
        (f) =>
          f.status === "done" ||
          f.status === "error" ||
          f.status === "cancelled" ||
          f.status === "interrupted"
      ),
    [files]
  );

  const value = useMemo(
    () => ({
      files,
      hydrated,
      zipBatchActive,
      allDone,
      isDragOver,
      setIsDragOver,
      handleFiles,
      handleDrop,
      stopZipProcessing,
      clearUploadList,
      retryProcess,
    }),
    [
      files,
      hydrated,
      zipBatchActive,
      allDone,
      isDragOver,
      handleFiles,
      handleDrop,
      stopZipProcessing,
      clearUploadList,
      retryProcess,
    ]
  );

  return (
    <InvoiceUploadContext.Provider value={value}>
      {children}
    </InvoiceUploadContext.Provider>
  );
}

export function useInvoiceUpload() {
  const ctx = useContext(InvoiceUploadContext);
  if (!ctx) {
    throw new Error("useInvoiceUpload must be used within InvoiceUploadProvider");
  }
  return ctx;
}
