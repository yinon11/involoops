"use client";

import { useState, useTransition } from "react";
import { resendVerificationEmail } from "@/actions/email-verification-actions";
import { useT } from "@/lib/i18n/client";

export function UnverifiedEmailBanner({ email }: { email: string }) {
  const dict = useT().auth.verifyEmail.banner;
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  function onResend() {
    if (!email) return;
    setMessage(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("email", email);
      const result = await resendVerificationEmail(fd);
      if (result?.error) {
        setMessage({ kind: "error", text: result.error });
      } else if (result?.success) {
        setMessage({
          kind: "success",
          text: result.message ?? dict.resend,
        });
      }
    });
  }

  return (
    <div className="border-b border-yellow-200 bg-yellow-50 text-yellow-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
        <div className="flex-1">
          <strong>{dict.title}</strong>{" "}
          <span className="text-yellow-800">{dict.description}</span>
          {message && (
            <div
              className={`mt-1 text-xs ${
                message.kind === "success"
                  ? "text-green-700"
                  : "text-red-700"
              }`}
            >
              {message.text}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onResend}
          disabled={isPending}
          className="rounded-md bg-yellow-200 px-3 py-1 text-xs font-medium text-yellow-900 hover:bg-yellow-300 disabled:opacity-50"
        >
          {isPending ? dict.resending : dict.resend}
        </button>
      </div>
    </div>
  );
}
