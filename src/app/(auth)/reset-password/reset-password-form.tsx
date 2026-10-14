"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { resetPasswordWithToken } from "@/actions/password-reset-actions";
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

type FormData = { password: string; confirmPassword: string };

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useT().auth.resetPassword;
  const router = useRouter();
  // Schema is rebuilt per-render so zod errors follow the active locale.
  const schema = useMemo(
    () =>
      z
        .object({
          password: z.string().min(8, t.errors.passwordMinLength),
          confirmPassword: z.string(),
        })
        .refine((d) => d.password === d.confirmPassword, {
          message: t.errors.passwordsDoNotMatch,
          path: ["confirmPassword"],
        }),
    [t]
  );
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
    startTransition(async () => {
      const formData = new FormData();
      formData.append("token", token);
      formData.append("password", data.password);
      formData.append("confirmPassword", data.confirmPassword);
      const result = await resetPasswordWithToken(formData);
      if (result?.error) {
        setError(result.error);
      } else if (result?.success) {
        router.push("/login?reset=1");
      }
    });
  }

  if (!token) {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>{t.invalidTitle}</CardTitle>
          <CardDescription>
            {t.invalidDescription}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            {t.requestNewLink}
          </Link>
        </CardFooter>
      </Card>
    );
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
          <div className="space-y-2">
            <Label htmlFor="password">{t.newPassword}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-red-500">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t.confirmPassword}</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-red-500">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? t.submitting : t.submit}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <Link href="/login" className="text-sm text-primary hover:underline">
          {t.backToSignIn}
        </Link>
      </CardFooter>
    </Card>
  );
}
