"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type Props = {
  /** e.g. `/api/files/preview?invoiceId=...` (root-relative) */
  previewSrc: string | null;
  title: string;
  className?: string;
};

type Loaded = {
  blobUrl: string;
  isImage: boolean;
  /** Raw bytes for non-image content; used by the mobile PDF canvas path. */
  pdfBytes: ArrayBuffer | null;
};

/**
 * Loads the file via fetch (credentials) then shows it in an iframe with a blob: URL.
 * Avoids iframe navigations that resolve relative `file_url` keys as `/pending/...` (404)
 * and is more reliable for same-origin cookies than raw iframe src to the API route.
 *
 * Mobile browsers (Chrome on Android, Safari on iOS) don't render PDFs inside
 * iframes — the area appears blank/broken. So we branch on content type:
 *   - Images go in an `<img>` (works everywhere).
 *   - PDFs use an iframe on desktop (sm and up) and a client-side pdf.js canvas
 *     render on mobile, with an "Open in new tab" affordance as a final fallback.
 */
export function InvoicePreviewFrame({ previewSrc, title, className }: Props) {
  const t = useT().invoices.preview;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const src = previewSrc?.trim() ?? "";
    if (!src) {
      setLoaded(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let createdObjectUrl: string | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      setLoaded(null);

      try {
        const fetchUrl =
          typeof window !== "undefined"
            ? new URL(src, window.location.origin).href
            : src;
        const res = await fetch(fetchUrl, {
          credentials: "include",
          cache: "no-store",
        });
        const ct = res.headers.get("content-type") || "";

        if (ct.includes("text/html")) {
          if (!cancelled) {
            setError(t.errors.sessionOrRoute);
          }
          return;
        }

        if (!res.ok) {
          // 401 and 403 used to collapse into one message, so a signed-out
          // session and a file stored under an unexpected key were
          // indistinguishable to both the user and whoever they reported it
          // to. They need different actions, so they say different things.
          if (!cancelled) {
            setError(
              res.status === 404
                ? t.errors.notFound
                : res.status === 401
                  ? t.errors.sessionExpired
                  : res.status === 403
                    ? format(t.errors.unexpectedPath, {
                        id: previewSrc?.match(/invoiceId=([\w-]+)/)?.[1] ?? "",
                      })
                    : format(t.errors.httpStatus, { status: res.status })
            );
          }
          return;
        }

        const blob = await res.blob();
        if (cancelled) return;

        const isImage = ct.startsWith("image/");
        // Buffer the bytes once for the pdf.js canvas path. Reading from
        // the blob URL inside pdf.js works in most browsers but failed
        // intermittently on iOS Safari with `cache: "no-store"`; passing
        // raw bytes avoids that whole class of issues.
        const pdfBytes = isImage ? null : await blob.arrayBuffer();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdObjectUrl = url;
        setLoaded({ blobUrl: url, isImage, pdfBytes });
      } catch {
        if (!cancelled) setError(t.errors.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [previewSrc, t]);

  if (!previewSrc?.trim()) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-muted-foreground">
        <FileText className="mb-2 h-10 w-10" />
        <p className="text-sm">{t.noFile}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
        <FileText className="h-10 w-10" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (loading || !loaded) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-muted-foreground">
        <Loader2 className="mb-2 h-10 w-10 animate-spin" />
        <p className="text-sm">{t.loading}</p>
      </div>
    );
  }

  if (loaded.isImage) {
    return (
      <img
        src={loaded.blobUrl}
        alt={title}
        className={`${className ?? ""} object-contain`}
      />
    );
  }

  // PDF (or unknown binary). Desktop gets the native iframe viewer.
  // Mobile (sm and below) gets a client-side pdf.js canvas render —
  // mobile browsers refuse to render PDFs in iframes, and a tap-to-open
  // link was a bad UX (the user lost the queue context to a new tab).
  return (
    <>
      <iframe
        src={loaded.blobUrl}
        className={`hidden sm:block ${className ?? ""}`}
        title={title}
      />
      {loaded.pdfBytes ? (
        <PdfMobileCanvas
          data={loaded.pdfBytes}
          previewSrc={previewSrc ?? "#"}
        />
      ) : (
        <a
          href={previewSrc ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-full min-h-[400px] w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground hover:text-foreground sm:hidden"
        >
          <FileText className="h-10 w-10" />
          <span className="font-medium">{t.tapToOpen}</span>
          <span className="inline-flex items-center gap-1 text-xs">
            <ExternalLink className="h-3 w-3" />
            {t.opensInNewTab}
          </span>
        </a>
      )}
    </>
  );
}

/**
 * Mobile-only PDF renderer. Loads pdf.js dynamically (so the ~300KB
 * worker-less bundle is excluded from initial route chunks), renders
 * every page to a `<canvas>` at device-pixel ratio, and lets the user
 * scroll vertically. Gated by `matchMedia` so we don't burn main-thread
 * CPU on desktop where the iframe path is doing the same job.
 *
 * Worker is disabled (`disableWorker: true`) — typical invoice PDFs are
 * 1-3 pages so the main-thread cost is negligible, and avoids having
 * to bundle / serve a separate `pdf.worker.mjs` from `/_next/static`
 * with the right Content-Type under Turbopack.
 */
function PdfMobileCanvas({
  data,
  previewSrc,
}: {
  data: ArrayBuffer;
  previewSrc: string;
}) {
  const t = useT().invoices.preview;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "rendering" | "done" | "error">(
    "idle"
  );

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 639.5px)").matches) {
      // Desktop — the iframe alongside us handles rendering.
      return;
    }

    setStatus("rendering");

    async function render() {
      try {
        const pdfjs = await import("unpdf/pdfjs");
        // `getDocument` mutates / detaches the input ArrayBuffer, so
        // pass a copy — keeps the parent state reusable across remounts.
        // No `worker` / `workerSrc` is set on purpose: the bundled pdfjs
        // in `unpdf/pdfjs` falls back to a main-thread "fake worker",
        // which is fine for typical 1-3 page invoices and avoids having
        // to bundle / serve `pdf.worker.mjs` from `/_next/static` with
        // the right Content-Type under Turbopack.
        const copy = data.slice(0);
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(copy),
        });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        const node = containerRef.current;
        if (!node) return;
        while (node.firstChild) node.removeChild(node.firstChild);

        const dpr = window.devicePixelRatio || 1;
        const containerWidth = node.clientWidth || window.innerWidth;

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) break;
          const page = await doc.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const cssScale = containerWidth / baseViewport.width;
          const renderViewport = page.getViewport({ scale: cssScale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(renderViewport.width);
          canvas.height = Math.floor(renderViewport.height);
          canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
          canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;
          canvas.style.display = "block";
          // Page separation now handled by `gap-2` on the flex parent —
          // see the container in the JSX below.
          canvas.className = "rounded-sm bg-white shadow-sm";

          // pdfjs >=5 prefers `canvas` over the legacy `canvasContext`
          // pair; passing both keeps the render task's internal canvas
          // reference aligned with the DOM node we just appended.
          await page.render({ canvas, viewport: renderViewport }).promise;
          if (cancelled) break;
          node.appendChild(canvas);
          page.cleanup();
        }

        await doc.destroy();
        if (!cancelled) setStatus("done");
      } catch (err) {
        if (!cancelled) {
          console.error("[invoice-preview] mobile pdf render failed", err);
          setStatus("error");
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [data]);

  return (
    // Fixed-height container so the inner scroller actually has bounds.
    // Without an explicit height the parent only enforced `min-h-[400px]`
    // and `overflow-y-auto` had no upper bound to clip against — the
    // canvases just kept stacking down the page.
    //
    // `h-[70vh]` keeps the preview window proportional to the device
    // (taller on a Pixel, shorter on landscape) while leaving room for
    // the form below; `max-h-[640px]` caps it on tablets in portrait
    // where 70vh would otherwise eat too much of the card.
    <div className="flex h-[70vh] max-h-[640px] w-full flex-col sm:hidden">
      <div className="relative flex-1 overflow-y-auto overscroll-contain bg-muted/40 px-2 py-2">
        <div
          ref={containerRef}
          className="flex flex-col items-stretch gap-2"
        />
        {status === "rendering" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-md bg-background/90 px-3 py-2 shadow-sm">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <FileText className="h-10 w-10" />
            <span>{t.cannotRenderPdf}</span>
            <a
              href={previewSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t.openInNewTab}
            </a>
          </div>
        )}
      </div>
      <a
        href={previewSrc}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1 border-t bg-background px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        Open in new tab for full-screen / zoom
      </a>
    </div>
  );
}
