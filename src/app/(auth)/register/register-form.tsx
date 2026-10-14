"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signupAction } from "@/actions/auth-actions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { useGoogleProviderEnabled } from "@/hooks/use-google-provider-enabled";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/lib/i18n/client";

interface RegisterFormProps {
  /** Where the user should land after sign-in following registration. */
  callbackUrl?: string;
  /** Pre-fills the email field (e.g. from an invitation link). */
  presetEmail?: string;
}

export function RegisterForm({ callbackUrl, presetEmail }: RegisterFormProps = {}) {
  const dict = useT();
  const googleEnabled = useGoogleProviderEnabled();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const signupSchema = useMemo(
    () =>
      z
        .object({
          name: z.string().min(2, dict.auth.register.errors.nameMinLength),
          email: z.string().email(dict.auth.register.errors.invalidEmail),
          password: z
            .string()
            .min(8, dict.auth.register.errors.passwordMinLength)
            .regex(
              /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
              dict.auth.register.errors.passwordComplexity
            ),
          confirmPassword: z.string(),
          consent: z.boolean().refine((v) => v === true, {
            message: dict.auth.register.errors.consentRequired,
          }),
          marketingOptIn: z.boolean(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: dict.auth.register.errors.passwordsDoNotMatch,
          path: ["confirmPassword"],
        }),
    [dict]
  );
  type SignupFormData = z.infer<typeof signupSchema>;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: presetEmail ?? "",
      confirmPassword: "",
      consent: false,
      marketingOptIn: false,
    },
  });

  function onSubmit(data: SignupFormData) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("email", data.email);
      formData.append("password", data.password);
      formData.append("consent", data.consent ? "true" : "false");
      formData.append(
        "marketingOptIn",
        data.marketingOptIn ? "true" : "false"
      );
      const result = await signupAction(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.success) {
        toast.success(dict.auth.register.toastSuccess);
        const params = new URLSearchParams({ registered: "1" });
        if (callbackUrl) params.set("callbackUrl", callbackUrl);
        if (data.email) params.set("email", data.email);
        router.push(`/login?${params.toString()}`);
      }
    });
  }

  return (
    <Card className="shadow-lg" data-highlight="page-register">
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
        <CardDescription>{dict.auth.register.title}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleSignInButton
          googleEnabled={googleEnabled === true}
          callbackUrl={callbackUrl}
        />
        {googleEnabled === true && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                {dict.auth.register.separator}
              </span>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">{dict.auth.register.name}</Label>
            <Input
              id="name"
              type="text"
              placeholder={dict.auth.register.namePlaceholder}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{dict.auth.register.email}</Label>
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
            <Label htmlFor="password">{dict.auth.register.password}</Label>
            <Input
              id="password"
              type="password"
              placeholder={dict.auth.register.passwordHint}
              dir="ltr"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-red-500">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">
              {dict.auth.register.confirmPassword}
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder={dict.auth.register.confirmPasswordPlaceholder}
              dir="ltr"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-red-500">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Controller
                control={control}
                name="consent"
                render={({ field }) => (
                  <Checkbox
                    id="consent"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                    className="mt-0.5"
                  />
                )}
              />
              <Label
                htmlFor="consent"
                className="text-sm font-normal leading-tight"
              >
                {dict.auth.register.consentPrefix}{" "}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {dict.auth.register.tosLink}
                </Link>{" "}
                {dict.auth.register.consentJoiner}{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {dict.auth.register.privacyLink}
                </Link>
              </Label>
            </div>
            {errors.consent && (
              <p className="text-sm text-red-500">{errors.consent.message}</p>
            )}
            <div className="flex items-start gap-2">
              <Controller
                control={control}
                name="marketingOptIn"
                render={({ field }) => (
                  <Checkbox
                    id="marketingOptIn"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                    className="mt-0.5"
                  />
                )}
              />
              <Label
                htmlFor="marketingOptIn"
                className="text-sm font-normal leading-tight"
              >
                {dict.auth.register.marketingOptIn}
              </Label>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending
              ? dict.auth.register.creatingAccount
              : dict.auth.register.signUp}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {dict.auth.register.haveAccount}{" "}
          <Link
            href={(() => {
              const params = new URLSearchParams();
              if (callbackUrl) params.set("callbackUrl", callbackUrl);
              if (presetEmail) params.set("email", presetEmail);
              const qs = params.toString();
              return qs ? `/login?${qs}` : "/login";
            })()}
            className="font-medium text-primary hover:underline"
          >
            {dict.auth.register.signIn}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
