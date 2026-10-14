"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  tone?: "neutral" | "warning" | "error" | "success";
}

const toneClass: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "",
  warning: "border-amber-300 bg-amber-50",
  error: "border-red-300 bg-red-50",
  success: "border-green-200 bg-green-50",
};

export function OnboardingStepCard({
  title,
  description,
  children,
  tone = "neutral",
}: Props) {
  return (
    <Card className={toneClass[tone]}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && (
          <p className="text-sm text-gray-600">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
