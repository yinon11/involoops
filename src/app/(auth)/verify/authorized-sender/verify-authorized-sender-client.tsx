"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { verifyAuthorizedSenderAction } from "@/features/expenses/actions/authorized-sender-actions";
import { useT } from "@/lib/i18n/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Status = "verifying" | "success" | "error";

export function VerifyAuthorizedSenderClient({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const t = useT();
  const dict = t.auth.verifyAuthorizedSender;
  const [status, setStatus] = useState<Status>(
    token && email ? "verifying" : "error",
  );
  const [error, setError] = useState<string | null>(
    token && email ? null : dict.errorMissing,
  );
  const hasRun = useRef(false);

  useEffect(() => {
    if (!token || !email) return;
    // Guard against React strict-mode's double effect so the single-use token
    // isn't consumed twice on one page load.
    if (hasRun.current) return;
    hasRun.current = true;

    (async () => {
      const result = await verifyAuthorizedSenderAction({ token, email });
      if ("success" in result && result.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setError(("error" in result && result.error) || dict.errorTitle);
      }
    })();
  }, [token, email, dict.errorTitle]);

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">
          {status === "verifying" && dict.verifyingTitle}
          {status === "success" && dict.successTitle}
          {status === "error" && dict.errorTitle}
        </CardTitle>
        <CardDescription>
          {status === "verifying" && dict.verifyingDescription}
          {status === "success" && dict.successDescription}
          {status === "error" && (error ?? dict.errorTitle)}
        </CardDescription>
      </CardHeader>
      {status === "verifying" && (
        <CardContent className="flex justify-center py-6">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
            aria-label={t.common.loading}
          />
        </CardContent>
      )}
      <CardFooter className="justify-center">
        {status !== "verifying" && (
          <Link href="/" className="text-sm text-primary hover:underline">
            {dict.goToApp}
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}
