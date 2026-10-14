"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { loginAction } from "@/actions/auth-actions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { useGoogleProviderEnabled } from "@/hooks/use-google-provider-enabled";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { InvoloopsStudioMark } from "@/components/brand/involoops-studio-mark";
import { useT } from "@/lib/i18n/client";

type LoginFormProps = {
  resetOk?: boolean;
  registered?: boolean;
  verified?: boolean;
  /** Auth.js OAuth / callback error (e.g. OAuthAccountNotLinked) */
  authError?: string;
  /** Where to send the user after successful sign-in. Defaults to /dashboard. */
  callbackUrl?: string;
  /** Pre-fills the email field (e.g. from an invitation link). */
  presetEmail?: string;
  /**
   * Accountant entry point. Same credentials flow, but the UI is branded for
   * accountants and successful sign-in routes feature holders straight to the
   * Studio shell instead of the default dashboard.
   */
  accountant?: boolean;
};

export function LoginForm({
  resetOk = false,
  registered = false,
  verified = false,
  authError,
  callbackUrl,
  presetEmail,
  accountant = false,
}: LoginFormProps) {
  const dict = useT();
  const googleEnabled = useGoogleProviderEnabled();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  // Schema is rebuilt per-render so zod errors follow the active locale.
  const loginSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(dict.auth.login.errors.invalidEmail),
        password: z.string().min(1, dict.auth.login.errors.passwordRequired),
      }),
    [dict]
  );
  type LoginFormData = z.infer<typeof loginSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: presetEmail ?? "",
      password: "",
    },
  });

  function onSubmit(data: LoginFormData) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("email", data.email);
      formData.append("password", data.password);
      if (mfaRequired && mfaCode) {
        formData.append("mfaCode", mfaCode);
      }
      if (callbackUrl) {
        formData.append("callbackUrl", callbackUrl);
      }
      if (accountant) {
        formData.append("accountant", "true");
      }
      const result = await loginAction(formData);
      if (result?.mfaRequired) {
        setMfaRequired(true);
        if (result.error) setError(result.error);
        return;
      }
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.ok && result.redirectTo) {
        // Full-page navigation (not a soft router push) so the freshly-set
        // session cookie is sent to the resolver route handler on the very
        // first request — avoids the post-login bounce to /login that only
        // cleared on manual refresh.
        window.location.assign(result.redirectTo);
      }
    });
  }

  return (
    <Card className="shadow-lg" data-highlight="page-login">
      <CardHeader className="text-center">
        <CardTitle className="flex justify-center">
          <Image
            src="/brand/involoops-lockup-horizontal.svg"
            alt={dict.common.appName}
            width={520}
            height={130}
            className="h-10 w-auto"
            priority
          />
        </CardTitle>
        {accountant ? (
          <div className="flex flex-col items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-teal-200/70 bg-teal-50/80 px-3 py-1">
              <InvoloopsStudioMark size={14} color="#0D9488" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-700">
                {dict.auth.login.accountant.badge}
              </span>
            </span>
            <CardTitle className="text-lg">
              {dict.auth.login.accountant.title}
            </CardTitle>
            <CardDescription>
              {dict.auth.login.accountant.subtitle}
            </CardDescription>
          </div>
        ) : (
          <CardDescription>{dict.auth.login.title}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleSignInButton
          googleEnabled={googleEnabled === true}
          callbackUrl={callbackUrl}
          accountant={accountant}
        />
        {googleEnabled === true && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                {dict.auth.login.separator}
              </span>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {resetOk && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              {dict.auth.login.resetOk}
            </div>
          )}
          {registered && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              {dict.auth.login.registered}
            </div>
          )}
          {verified && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              {dict.auth.login.verified}
            </div>
          )}
          {authError && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {authError}
            </div>
          )}
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">{dict.auth.login.email}</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              dir="ltr"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{dict.auth.login.password}</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                {dict.auth.login.forgotPassword}
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="********"
              dir="ltr"
              readOnly={mfaRequired}
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-red-500">{errors.password.message}</p>
            )}
          </div>
          {mfaRequired && (
            <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
              <Label htmlFor="mfaCode" className="text-sm font-medium">
                Authenticator code
              </Label>
              <p className="text-xs text-muted-foreground">
                Enter the 6-digit code from your authenticator app, or a
                backup code.
              </p>
              <Input
                id="mfaCode"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="000000"
                dir="ltr"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                autoFocus
              />
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={isPending || (mfaRequired && mfaCode.trim().length === 0)}
          >
            {isPending
              ? dict.auth.login.signingIn
              : mfaRequired
                ? "Verify and Sign In"
                : dict.auth.login.signIn}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {dict.auth.login.noAccount}{" "}
          <Link
            href={(() => {
              const params = new URLSearchParams();
              if (callbackUrl) params.set("callbackUrl", callbackUrl);
              if (presetEmail) params.set("email", presetEmail);
              const qs = params.toString();
              return qs ? `/register?${qs}` : "/register";
            })()}
            className="font-medium text-primary hover:underline"
          >
            {dict.auth.login.signUp}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
