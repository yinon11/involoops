"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const AUTH_BASE = "/api/auth";

function GoogleIcon() {
  return (
    <svg
      aria-hidden
      className="me-2 h-4 w-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/**
 * Full document navigation via POST (CSRF + callbackUrl). This matches what Auth.js expects
 * and avoids fetch()+JSON flows that can fail when responses are not JSON or cookies are dropped.
 */
function postToGoogleSignIn(csrfToken: string, callbackUrl: string) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${AUTH_BASE}/signin/google`;
  form.style.display = "none";

  const csrf = document.createElement("input");
  csrf.name = "csrfToken";
  csrf.value = csrfToken;

  const cb = document.createElement("input");
  cb.name = "callbackUrl";
  cb.value = callbackUrl;

  form.appendChild(csrf);
  form.appendChild(cb);
  document.body.appendChild(form);
  form.submit();
}

export function GoogleSignInButton({
  googleEnabled,
  callbackUrl,
  accountant = false,
}: {
  googleEnabled: boolean;
  /**
   * Relative path to send the user back to after Google completes the
   * OAuth round-trip. Falls back to `/dashboard` so existing call sites
   * keep working unchanged.
   */
  callbackUrl?: string;
  /**
   * Accountant entry point. Routes the post-OAuth callback through the
   * Studio-aware resolver so feature holders land in the Studio shell.
   */
  accountant?: boolean;
}) {
  const [pending, setPending] = useState(false);

  if (!googleEnabled) {
    return null;
  }

  async function handleGoogleSignIn() {
    setPending(true);
    try {
      const res = await fetch(`${AUTH_BASE}/csrf`, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`CSRF ${res.status}`);
      }
      const data = (await res.json()) as { csrfToken?: string };
      if (!data.csrfToken) {
        throw new Error("Missing CSRF token");
      }
      // Only relative paths are accepted as callbacks (open-redirect guard).
      // Route through the entry-session resolver so a sub-user with a single
      // linked owner lands directly inside that owner's account. The resolver
      // forwards an explicit deep-link via `next` for everyone else. The
      // accountant variant uses the Studio-aware wrapper resolver instead.
      const resolver = accountant
        ? "/api/auth/resolve-accountant-entry"
        : "/api/auth/resolve-entry-session";
      const target =
        callbackUrl && callbackUrl.startsWith("/")
          ? `${resolver}?next=${encodeURIComponent(callbackUrl)}`
          : resolver;
      const absoluteCallback = new URL(target, window.location.origin).href;
      postToGoogleSignIn(data.csrfToken, absoluteCallback);
    } catch {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={() => void handleGoogleSignIn()}
    >
      <GoogleIcon />
      {pending ? "Connecting…" : "Continue with Google"}
    </Button>
  );
}
