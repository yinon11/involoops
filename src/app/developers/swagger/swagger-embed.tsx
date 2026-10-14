"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Mounts Swagger UI 5.x from the jsDelivr CDN.
 *
 * We deliberately DON'T use `next/script`: its `onLoad` callback isn't
 * reliable for `afterInteractive` scripts during client-side route
 * transitions, so visiting `/developers/swagger` via SPA navigation from
 * `/developers` would leave the page blank until a hard refresh
 * (the script tag was injected but its load event never re-bridged into
 * React state, so `SwaggerUIBundle` was never invoked).
 *
 * Instead we inject the <script> + <link> ourselves, once, and resolve a
 * promise when the bundle is ready. Idempotent across remounts and shared
 * by every <SwaggerUiEmbed /> instance on the page.
 *
 * Kept as a CDN embed — no package.json dependency, no build cost,
 * swappable any time. Deep-link anchors built by `swaggerUiUrl()` rely
 * on the explicit `operationId`s in `src/lib/api/openapi.ts`.
 */
declare global {
  interface Window {
    SwaggerUIBundle?: (config: Record<string, unknown>) => unknown;
  }
}

const SWAGGER_JS_URL =
  "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js";
const SWAGGER_CSS_URL =
  "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css";
const SCRIPT_ID = "involoops-swagger-ui-bundle";
const STYLE_ID = "involoops-swagger-ui-style";

function ensureSwaggerStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = SWAGGER_CSS_URL;
  document.head.appendChild(link);
}

function loadSwaggerBundle(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (typeof window.SwaggerUIBundle === "function") return Promise.resolve();

  const existing = document.getElementById(
    SCRIPT_ID,
  ) as HTMLScriptElement | null;
  if (existing) {
    // Another <SwaggerUiEmbed /> already started loading the bundle —
    // piggyback on its load event instead of injecting a duplicate.
    if (existing.dataset.loaded === "true") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Swagger UI bundle failed to load.")),
        { once: true },
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SWAGGER_JS_URL;
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error("Swagger UI bundle failed to load.")),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

export function SwaggerUiEmbed({ specUrl }: { specUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureSwaggerStyle();

    loadSwaggerBundle()
      .then(() => {
        if (cancelled) return;
        const node = containerRef.current;
        if (!node) return;
        if (typeof window.SwaggerUIBundle !== "function") {
          setError("Swagger UI bundle failed to load.");
          return;
        }
        try {
          window.SwaggerUIBundle({
            url: specUrl,
            domNode: node,
            deepLinking: true,
            displayOperationId: false,
            tryItOutEnabled: true,
            persistAuthorization: true,
            defaultModelsExpandDepth: 0,
            layout: "BaseLayout",
          });
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to render Swagger UI.",
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load Swagger UI from the CDN.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [specUrl]);

  return (
    <div className="bg-white">
      {error ? (
        <div className="mx-auto max-w-3xl px-6 py-12 text-center">
          <p className="text-slate-700">{error}</p>
          <p className="mt-2 text-sm text-slate-500">
            Fetch the raw spec at{" "}
            <a className="text-indigo-600 underline" href={specUrl}>
              {specUrl}
            </a>{" "}
            or head back to the{" "}
            <Link className="text-indigo-600 underline" href="/developers">
              Guide
            </Link>
            .
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="swagger-ui-container" />
      )}
      <noscript>
        <div className="mx-auto max-w-3xl px-6 py-12 text-center">
          <p className="text-slate-700">
            Swagger UI requires JavaScript. View the raw spec at{" "}
            <a className="text-indigo-600 underline" href={specUrl}>
              {specUrl}
            </a>
            .
          </p>
        </div>
      </noscript>
    </div>
  );
}
