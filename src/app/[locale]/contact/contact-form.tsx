"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMemo, useState, useTransition } from "react";
import { submitContactMessage } from "@/actions/contact-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/client";

type FormData = {
  name: string;
  email: string;
  subject?: string;
  message: string;
};

export function ContactForm() {
  const { dict } = useI18n();
  const t = dict.contact.form;

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t.errors.nameRequired).max(200),
        email: z.string().trim().email(t.errors.invalidEmail).max(320),
        subject: z.string().trim().max(200).optional(),
        message: z
          .string()
          .trim()
          .min(1, t.errors.messageRequired)
          .max(5000, t.errors.messageTooLong),
      }),
    [t.errors.nameRequired, t.errors.invalidEmail, t.errors.messageRequired, t.errors.messageTooLong]
  );

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  function onSubmit(data: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("email", data.email);
      if (data.subject) formData.append("subject", data.subject);
      formData.append("message", data.message);

      const result = await submitContactMessage(formData);
      if (result?.error) {
        setError(result.error);
      } else if (result?.success && result.message) {
        setMessage(result.message);
        reset();
      }
    });
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="involoops-contact-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
        >
          {error && (
            <div
              id="involoops-contact-error"
              className="rounded-md bg-red-50 p-3 text-sm text-red-600"
            >
              {error}
            </div>
          )}
          {message && (
            <div
              id="involoops-contact-success"
              className="rounded-md bg-green-50 p-3 text-sm text-green-800"
            >
              {message}
            </div>
          )}

          <div className="space-y-2" data-field="name">
            <Label htmlFor="name">{t.name}</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder={t.namePlaceholder}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2" data-field="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={t.emailPlaceholder}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2" data-field="subject">
            <Input
              id="subject"
              type="text"
              placeholder={t.subjectPlaceholder}
              {...register("subject")}
            />
            {errors.subject && (
              <p className="text-sm text-red-500">{errors.subject.message}</p>
            )}
          </div>

          <div className="space-y-2" data-field="message">
            <Textarea
              id="message"
              rows={6}
              placeholder={t.messagePlaceholder}
              {...register("message")}
            />
            {errors.message && (
              <p className="text-sm text-red-500">{errors.message.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? t.submitting : t.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
