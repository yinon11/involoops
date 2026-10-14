import type { Metadata } from "next";
import { PlaygroundClient } from "./playground-client";

export const metadata: Metadata = {
  title: "API Playground · InvoLoops Developers",
  description:
    "Live UI to exercise the InvoLoops REST API with your own bearer key — create customers, draft and issue invoices/receipts, and inspect raw responses.",
  robots: { index: false, follow: false },
};

/**
 * Browser-side sandbox for the public REST API. All calls are made
 * directly from the user's browser to `/api/v1/*` using the bearer
 * key they paste in. No session-cookie magic — what you see fired in
 * the activity log is exactly what an external integration would see.
 */
export default function PlaygroundPage() {
  return <PlaygroundClient />;
}
