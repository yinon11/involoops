"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { adminCreateUser } from "@/actions/admin-actions";
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

const schema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
});

type FormData = z.infer<typeof schema>;

export function AdminAddUserForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
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
    setSuccess(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("email", data.email);
      fd.append("password", data.password);
      const result = await adminCreateUser(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.success) {
        setSuccess(true);
        reset();
      }
    });
  }

  return (
    <Card className="max-w-md border-dashed">
      <CardHeader>
        <CardTitle className="text-lg">Add user</CardTitle>
        <CardDescription>
          Create a credentials account. The user can sign in from the login page
          with this email and password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-new-email">Email</Label>
            <Input
              id="admin-new-email"
              type="email"
              autoComplete="off"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-new-password">Password</Label>
            <Input
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-700" role="status">
              User created. They can sign in now.
            </p>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create user"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
