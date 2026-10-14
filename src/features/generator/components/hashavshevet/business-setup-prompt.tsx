import Link from "next/link";
import { Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  body: string;
  cta: string;
};

export function HashavshevetBusinessSetupPrompt({ title, body, cta }: Props) {
  return (
    <Card className="border-amber-200 bg-amber-50/60">
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <h2 className="font-semibold text-zinc-900">{title}</h2>
            <p className="text-sm text-zinc-600">{body}</p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/creator/business-details">{cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
