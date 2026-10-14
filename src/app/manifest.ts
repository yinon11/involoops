import type { MetadataRoute } from "next";

/**
 * Web App Manifest — used by browsers and search engines to enable PWA-style
 * install banners and richer SERP entries.
 *
 * Icons reference the existing brand PNGs under /public/brand/png/. The 192/512
 * pair is the de-facto minimum (Chrome/Android), and the maskable hint lets
 * Android render on non-circular safe areas without cropping the brand mark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "InvoLoops",
    short_name: "InvoLoops",
    description:
      "AI-powered invoice processing, expense analytics, and outbound invoicing — receipts in, invoices out.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#7c3aed",
    icons: [
      {
        src: "/brand/png/mark-violet-128.png",
        sizes: "128x128",
        type: "image/png",
      },
      {
        src: "/brand/png/appicon-180.png",
        sizes: "180x180",
        type: "image/png",
      },
      // Two entries per size — Next.js's typed Manifest only allows a single
      // `purpose` per icon, but the spec lets us list the same file twice
      // with different purposes so Android picks the right one for the
      // launcher (any) vs the adaptive mask (maskable).
      {
        src: "/brand/png/appicon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/png/appicon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/png/appicon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/png/appicon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/png/mark-violet-1024.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
