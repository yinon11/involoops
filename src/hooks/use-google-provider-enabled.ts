"use client";

import { useEffect, useState } from "react";

/**
 * Whether Google OAuth is enabled — from Auth.js at runtime (not build-time env inlining).
 * GET /api/auth/providers reflects the same config as the server.
 */
export function useGoogleProviderEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Record<string, unknown> | null) => {
        if (!cancelled && data) {
          setEnabled(Boolean(data.google));
        }
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
