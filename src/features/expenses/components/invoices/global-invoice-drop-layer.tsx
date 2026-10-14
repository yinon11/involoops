"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { useInvoiceUpload } from "@/contexts/invoice-upload-context";
import { cn } from "@/lib/utils";

const DROPZONE_ATTR = "[data-invoice-upload-dropzone]";

function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function isInsideUploadDropzone(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(DROPZONE_ATTR));
}

/**
 * Full-app drag-and-drop: dropping invoice files anywhere (except the dedicated
 * upload dropzone, which keeps its own UX) queues uploads and navigates to
 * `/invoices/upload` so progress is visible.
 */
export function GlobalInvoiceDropLayer() {
  const router = useRouter();
  const pathname = usePathname();
  const { handleFiles } = useInvoiceUpload();
  const [overlay, setOverlay] = useState(false);
  const depthRef = useRef(0);

  const endDrag = useCallback(() => {
    depthRef.current = 0;
    setOverlay(false);
  }, []);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      if (pathname !== "/invoices/upload") {
        setOverlay(true);
      }
    };

    const onDragLeave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current <= 0) {
        endDrag();
      }
    };

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !dragHasFiles(e)) return;
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = "copy";
      } catch {
        /* ignore */
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer || !dragHasFiles(e)) {
        endDrag();
        return;
      }
      if (isInsideUploadDropzone(e.target)) {
        endDrag();
        return;
      }
      e.preventDefault();
      const n =
        e.dataTransfer.files.length > 0
          ? handleFiles(e.dataTransfer.files)
          : 0;
      endDrag();
      if (n > 0 && pathname !== "/invoices/upload") {
        router.push("/invoices/upload");
      }
    };

    const onWindowBlur = () => endDrag();

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [endDrag, handleFiles, pathname, router]);

  if (!overlay || pathname === "/invoices/upload") return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3",
        "bg-indigo-950/40 backdrop-blur-[2px] transition-opacity"
      )}
      aria-hidden
    >
      <div
        className={cn(
          "flex max-w-md flex-col items-center gap-2 rounded-xl",
          "border-2 border-dashed border-white bg-white/95 px-8 py-10 text-center shadow-xl"
        )}
      >
        <Upload className="h-12 w-12 text-indigo-600" />
        <p className="text-base font-semibold text-gray-900">
          Drop invoices to upload
        </p>
        <p className="text-sm text-muted-foreground">
          PDF, images, or ZIP — you&apos;ll be taken to the Upload page
        </p>
      </div>
    </div>
  );
}
