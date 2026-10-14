"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { requestPasswordReset } from "@/actions/password-reset-actions";
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
import { useT } from "@/lib/i18n/client";

type FormData = { email: string };

export function ForgotPasswordForm() {
  const dict = useT();
  const t = dict.auth.forgotPassword;
  // Schema is rebuilt per-render so zod errors follow the active locale.
  const schema = useMemo(
    () => z.object({ email: z.string().email(t.errors.invalidEmail) }),
    [t]
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  function onSubmit(data: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("email", data.email);
      const result = await requestPasswordReset(formData);
      if (result?.error) {
        setError(result.error);
      } else if (result?.success && result.message) {
        setMessage(result.message);
      }
    });
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="flex justify-center">
          <Image
            src="/brand/involoops-lockup-horizontal.svg"
            alt="InvoLoops"
            width={520}
            height={130}
            className="h-10 w-auto"
            priority
          />
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              {message}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">{t.email}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t.emailPlaceholder}
              autoComplete="email"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email.message}</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? t.submitting : t.submit}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:underline"
        >
          {t.backToSignIn}
        </Link>
      </CardFooter>
    </Card>
  );
}
